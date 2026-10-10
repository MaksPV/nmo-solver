// Скрипт для страницы теста (QuizLib)
(function() {
  'use strict';

  // ===== Константы =====
  const CLICK_DELAY = 400;       // пауза после клика: Angular успевает перерисовать DOM
  const VERIFY_DELAY = 150;      // пауза перед проверкой состояния
  const POLL_INTERVAL = 200;    // как часто опрашиваем смену вопроса
  const NEXT_TIMEOUT = 10000;   // максимум ждём, пока сменится вопрос после «Следующий»
  const MANUAL_TIMEOUT = 120000; // сколько ждём ручной отметки в полуавтомате
  const NEXT_RE = /следующий|следующая|далее|дальше|next|продолжить/i;
  const FINISH_RE = /завершить|закончить|отправить|финиш|finish/i;

  function normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/[«»"']/g, '')
      .replace(/✅/g, '') // наш индикатор подсветки не должен ломать матчинг
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ===== Разбор текущего вопроса =====
  function getCurrentQuestion() {
    const questionCard = document.querySelector('.question');
    if (!questionCard) return null;

    const titleElement = questionCard.querySelector('.question-title-text');
    if (!titleElement) return null;

    const radioButtons = questionCard.querySelectorAll('mat-radio-button.radio-button_answer');
    const checkboxes = questionCard.querySelectorAll('mat-checkbox');

    const answers = [];
    // index — позиция среди элементов своего типа: нужен для повторного
    // поиска живого узла после того, как Angular перерисует вопрос
    const collect = (elements, type) => {
      elements.forEach((el, index) => {
        const input = el.querySelector(type === 'radio' ? 'input[type="radio"]' : 'input[type="checkbox"]');
        const label = el.querySelector('label');
        answers.push({
          element: el,
          input: input,
          rawText: label ? label.textContent.trim() : '',
          text: label ? normalizeText(label.textContent) : '',
          type: type,
          index: index
        });
      });
    };

    if (radioButtons.length > 0) {
      collect(radioButtons, 'radio');
    } else if (checkboxes.length > 0) {
      collect(checkboxes, 'checkbox');
    }

    const counterEl = questionCard.querySelector('.question-info-questionCounter');
    let currentNum = 0, totalNum = 0;
    if (counterEl) {
      const text = counterEl.textContent;
      const match = text.match(/Вопрос\s+(\d+)\s+из\s+(\d+)/i) || text.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        currentNum = parseInt(match[1], 10);
        totalNum = parseInt(match[2], 10);
      }
    }

    const questionText = titleElement.textContent.trim();

    return {
      text: questionText,
      answers: answers,
      isMulti: checkboxes.length > 0,
      currentNum: currentNum,
      totalNum: totalNum,
      isLastQuestion: currentNum > 0 && totalNum > 0 && currentNum >= totalNum,
      // ключ вопроса — для отслеживания смены вопроса после «Следующий»
      key: (currentNum > 0 ? currentNum + '|' : '') + questionText
    };
  }

  function findCorrectAnswers(questionText, savedAnswers) {
    const normalizedQuestion = normalizeText(questionText);

    for (const saved of savedAnswers) {
      const savedQuestion = normalizeText(saved.question);
      if (normalizedQuestion.includes(savedQuestion) || savedQuestion.includes(normalizedQuestion)) {
        const corrects = saved.answers.filter(a => a.isCorrect);
        console.log('[НМО] Вопрос найден в базе:', saved.question.substring(0, 70), '| верных:', corrects.length);
        return corrects;
      }
    }

    const questionWords = normalizedQuestion.split(' ').filter(w => w.length > 4);
    let bestMatch = null;
    let bestScore = 0;

    for (const saved of savedAnswers) {
      const savedQuestion = normalizeText(saved.question);
      let score = 0;
      for (const word of questionWords) {
        if (savedQuestion.includes(word)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = saved;
      }
    }

    if (bestMatch && bestScore >= 2) {
      console.log('[НМО] Совпадение:', bestMatch.question.substring(0, 80));
      return bestMatch.answers.filter(a => a.isCorrect);
    }

    return [];
  }

  // Числовые токены (даты, номера) — отличают почти одинаковые варианты
  function digitsOf(text) {
    return (text.match(/\d+/g) || []).slice().sort().join(',');
  }

  // Возвращает правильный ответ из базы, с которым совпал вариант (или null).
  // Важно: нечёткое сравнение включается только при совпадении чисел/дат —
  // иначе «указ ... 456» ошибочно матчится на «указ ... 490».
  function matchCorrectText(normalizedAnswer, correctTexts) {
    if (!normalizedAnswer) return null;
    for (const correctText of correctTexts) {
      if (!correctText) continue;

      // 1) точное совпадение
      if (normalizedAnswer === correctText) return correctText;

      // 2) вложенность
      if (normalizedAnswer.includes(correctText) || correctText.includes(normalizedAnswer)) {
        return correctText;
      }

      // 3) нечёткое совпадение — с защитой по числам
      if (similarity(normalizedAnswer, correctText) >= 0.9 &&
          digitsOf(normalizedAnswer) === digitsOf(correctText)) {
        return correctText;
      }
    }
    return null;
  }

  // Оценка похожести варианта на правильные ответы (0..1).
  // Используется для радио: выбираем ОДИН самый похожий вариант.
  function answerScore(optionText, correctTexts) {
    let best = 0;
    for (const ct of correctTexts) {
      if (!ct) continue;
      let s;
      if (optionText === ct) {
        s = 1;
      } else {
        s = similarity(optionText, ct);
        // вложенность даёт высокий балл
        if (optionText.includes(ct) || ct.includes(optionText)) {
          const ratio = Math.min(optionText.length, ct.length) / Math.max(optionText.length, ct.length, 1);
          s = Math.max(s, 0.9 + 0.09 * ratio);
        }
        // несовпадение чисел/дат — сильный штраф
        if (digitsOf(optionText) !== digitsOf(ct)) s *= 0.5;
      }
      if (s > best) best = s;
    }
    return best;
  }

  // Радио: единственный наиболее похожий вариант
  function bestRadioAnswer(question, correctTexts) {
    let best = null;
    let bestScore = 0;
    for (const answer of question.answers) {
      const s = answerScore(answer.text, correctTexts);
      if (s > bestScore) {
        bestScore = s;
        best = answer;
      }
    }
    return { answer: best, score: bestScore };
  }

  const RADIO_MIN_SCORE = 0.45; // ниже — считаем, что подходящего варианта нет

  // Какие варианты нужно отметить: для чекбоксов — все совпавшие,
  // для радио — ровно один самый похожий.
  function getTargets(question, correctTexts, verbose = true) {
    if (question.isMulti) {
      return question.answers.filter(a => matchCorrectText(a.text, correctTexts));
    }
    const best = bestRadioAnswer(question, correctTexts);
    if (best.answer && best.score >= RADIO_MIN_SCORE) {
      if (verbose) console.log('[НМО] Radio: лучший вариант "' + best.answer.text + '" (score ' + best.score.toFixed(3) + ')');
      return [best.answer];
    }
    if (verbose) console.log('[НМО] Radio: подходящий вариант не найден (лучший score ' + best.score.toFixed(3) + ')');
    return [];
  }

  // ===== Живые ссылки =====
  // Angular перерисовывает DOM вопроса при каждом клике — старые ссылки
  // на mat-checkbox «протухают» и клик по ним молча не срабатывает.
  // Поэтому перед каждым действием ищем элемент заново.
  function refindAnswer(answer) {
    const questionCard = document.querySelector('.question');
    if (!questionCard) return null;

    const selector = answer.type === 'radio'
      ? 'mat-radio-button.radio-button_answer'
      : 'mat-checkbox';
    const live = questionCard.querySelectorAll(selector);

    if (live[answer.index]) return live[answer.index];

    // запасной вариант — по тексту
    for (const el of live) {
      const label = el.querySelector('label');
      const t = label ? normalizeText(label.textContent) : '';
      if (t && t === answer.text) return el;
    }
    return null;
  }

  // ===== Клики =====
  function fireMouseSequence(el) {
    const rect = el.getBoundingClientRect();
    const mouseOpts = {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    const pointerOpts = Object.assign({}, mouseOpts, { pointerType: 'mouse', isPrimary: true });
    el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
    el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    el.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
    el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    el.dispatchEvent(new MouseEvent('click', mouseOpts));
  }

  async function clickCheckbox(el) {
    let input = el.querySelector('input[type="checkbox"]');
    if (!input) return false;
    if (input.checked) return true;

    // 1) Резкий рабочий способ: click() по живому input
    try { input.click(); } catch (e) { }
    await sleep(CLICK_DELAY);
    input = el.querySelector('input[type="checkbox"]');
    if (input && input.checked) return true;

    // 2) Фолбэк: полная pointer/mouse-последовательность по label
    const label = el.querySelector('label');
    if (label) {
      try { fireMouseSequence(label); } catch (e) { }
      await sleep(CLICK_DELAY);
      input = el.querySelector('input[type="checkbox"]');
      if (input && input.checked) return true;
    }

    // 3) Последний фолбэк: checked + события
    input = el.querySelector('input[type="checkbox"]');
    if (input) {
      try {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) { }
      await sleep(VERIFY_DELAY);
      return input.checked;
    }
    return false;
  }

  async function clickRadio(el) {
    const input = el.querySelector('input[type="radio"]');
    if (!input) return false;
    if (input.checked) return true;

    // 1) Рабочий способ для радио: checked + события
    try {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (e) { }
    await sleep(VERIFY_DELAY);
    if (input.checked) return true;

    // 2) Фолбэк: click() по input, затем последовательность по label
    try { input.click(); } catch (e) { }
    await sleep(VERIFY_DELAY);
    if (input.checked) return true;

    const label = el.querySelector('label');
    if (label) {
      try { fireMouseSequence(label); } catch (e) { }
      await sleep(VERIFY_DELAY);
    }
    return input.checked;
  }

  // Проверка отметки по СВЕЖЕМУ узлу: Angular мог перерисовать DOM после клика
  function isLiveChecked(answer) {
    const el = refindAnswer(answer);
    const input = el && el.querySelector('input');
    return !!(input && input.checked);
  }

  // Применяем ответы: радио (один самый похожий) и чекбоксы (все совпавшие)
  // кликаются автоматически, перед каждым кликом узел перезапрашивается.
  async function applyAnswers(question, correctAnswers) {
    const correctTexts = correctAnswers.map(c => normalizeText(c.text));
    const targets = getTargets(question, correctTexts);
    const failed = [];
    const selected = [];

    for (const answer of targets) {
      const matched = matchCorrectText(answer.text, correctTexts) ||
        (answer.type === 'radio' ? '(radio best match)' : '');
      selected.push(answer);

      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const liveEl = refindAnswer(answer);
        if (!liveEl) break;

        const clicked = answer.type === 'radio'
          ? await clickRadio(liveEl)
          : await clickCheckbox(liveEl);
        if (!clicked) continue;

        // финальная проверка по свежему узлу
        await sleep(CLICK_DELAY);
        ok = isLiveChecked(answer);
      }

      if (ok) {
        console.log('[НМО] ✅ Отмечено:', answer.text, '← база:', matched);
      } else {
        console.log('[НМО] ❌ Не удалось отметить:', answer.text, '← база:', matched);
        failed.push(answer);
      }
      await sleep(100);
    }

    return { found: targets.length > 0, allOk: failed.length === 0, failed, selected };
  }

  // ===== Подсветка (визуальный фидбек, после кликов) =====
  // Подсвечиваем именно выбранные варианты (для радио — один),
  // элемент берём «живой» через refindAnswer.
  function highlightAnswers(question, correctAnswers, selected) {
    const correctTexts = correctAnswers.map(c => normalizeText(c.text));
    const targets = (selected && selected.length)
      ? selected
      : question.answers.filter(a => matchCorrectText(a.text, correctTexts));
    let highlighted = 0;

    for (const answer of targets) {
      const el = refindAnswer(answer) || answer.element;
      if (!el) continue;

      el.style.removeProperty('border');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('background');
      el.style.removeProperty('transition');
      el.style.removeProperty('borderRadius');
      el.style.removeProperty('padding');

      if (!el.querySelector('.nmo-correct-indicator')) {
        const indicator = document.createElement('span');
        indicator.className = 'nmo-correct-indicator';
        indicator.textContent = ' ✅';
        indicator.style.cssText = 'margin-left:8px;color:#4CAF50;font-weight:bold;font-size:14px;animation:pulse 1s infinite;';
        const label = el.querySelector('label');
        if (label) label.appendChild(indicator);
      }

      el.style.border = '2px solid #4CAF50';
      el.style.boxShadow = '0 0 8px rgba(76,175,80,0.5)';
      el.style.background = 'rgba(76,175,80,0.08)';
      el.style.transition = 'all 0.3s';
      el.style.borderRadius = '8px';
      el.style.padding = '4px';
      highlighted++;
    }
    return highlighted;
  }

  // Сброс подсветки — по живым элементам (после перерисовки Angular
  // старые ссылки могут быть оторваны от DOM)
  function clearHighlights() {
    const card = document.querySelector('.question');
    if (!card) return;
    card.querySelectorAll('.nmo-correct-indicator').forEach(el => el.remove());
    card.querySelectorAll('mat-checkbox, mat-radio-button').forEach(el => {
      el.style.removeProperty('border');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('background');
      el.style.removeProperty('transition');
      el.style.removeProperty('borderRadius');
      el.style.removeProperty('padding');
    });
  }

  // ===== Кнопки =====
  function getNextButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const isNext = b => NEXT_RE.test(b.textContent) && !FINISH_RE.test(b.textContent);

    // Основная кнопка вопроса, но ТОЛЬКО «Следующий/Далее» — никогда «Завершить»
    const primary = buttons.find(b => b.classList.contains('question-buttons-primary') && isNext(b));
    if (primary) return primary;

    const enabled = buttons.find(b => isNext(b) && !b.disabled);
    if (enabled) return enabled;

    return buttons.find(isNext(b)) || null;
  }

  function isTestFinished() {
    return !!document.querySelector('.result-screen, .test-finished, .quiz-result, [class*="result"]');
  }

  // Последний вопрос: счётчик «N из N» ИЛИ (нет «Следующий», но есть «Завершить»)
  function isFinalState(question) {
    if (question && question.isLastQuestion) return true;
    const buttons = Array.from(document.querySelectorAll('button'));
    const hasNext = buttons.some(b => NEXT_RE.test(b.textContent) && !FINISH_RE.test(b.textContent));
    const hasFinish = buttons.some(b => FINISH_RE.test(b.textContent));
    return !hasNext && hasFinish;
  }

  // Ждём, пока сменится вопрос после клика по «Следующий»
  async function clickNextAndWait(question, attempts) {
    attempts[question.key] = (attempts[question.key] || 0) + 1;
    if (attempts[question.key] > 3) {
      showNotification('⚠️ Не удаётся перейти к следующему вопросу — останавливаюсь');
      autoMode = false;
      return;
    }

    const nextBtn = getNextButton();
    if (!nextBtn) {
      showNotification('⚠️ Кнопка «Следующий вопрос» не найдена');
      autoMode = false;
      return;
    }

    try { nextBtn.click(); } catch (e) { }
    showNotification('➡️ Следующий...');

    const started = Date.now();
    while (autoMode && Date.now() - started < NEXT_TIMEOUT) {
      await sleep(POLL_INTERVAL);
      const q = getCurrentQuestion();
      if (!q) {
        if (isTestFinished()) {
          showNotification('🏁 Тест завершён!');
          autoMode = false;
        }
        continue;
      }
      if (q.key !== question.key) return; // новый вопрос отрендерился
    }
    showNotification('⚠️ Вопрос не сменился, пробую ещё раз...');
  }

  // Полуавтомат для этого вопроса: ждём, пока пользователь отметит нужные
  // варианты вручную (или сам переключит вопрос)
  async function waitForManualOrSkip(question, correctAnswers, found = true) {
    showNotification(
      found
        ? '⚠️ Не все ответы отметились — отметь подсвеченные вручную'
        : '⚠️ Автоматически подобрать не удалось — выбери ответ вручную',
      15000
    );
    const correctTexts = correctAnswers.map(c => normalizeText(c.text));
    const started = Date.now();

    while (autoMode && Date.now() - started < MANUAL_TIMEOUT) {
      await sleep(500);
      const live = getCurrentQuestion();
      if (!live) return 'changed';               // вопрос исчез (сменился/завершился)
      if (live.key !== question.key) return 'changed';

      const targets = getTargets(live, correctTexts, false);
      // ждём, пока все целевые варианты отмечены (или пользователь переключил вопрос)
      if (targets.length > 0 && targets.every(a => a.input && a.input.checked)) {
        return 'checked';
      }
    }
    return autoMode ? 'timeout' : 'stopped';
  }

  let autoMode = false;

  async function autoAnswerLoop() {
    autoMode = true;
    updateAutoButton();

    const attempts = {};

    while (autoMode) {
      const result = await browser.storage.local.get('nmoAnswers');
      const savedAnswers = result.nmoAnswers || [];
      if (savedAnswers.length === 0) {
        showNotification('❌ Нет сохранённых ответов');
        break;
      }

      const question = getCurrentQuestion();
      if (!question) {
        showNotification('🏁 Тест завершён или вопрос не найден');
        break;
      }

      clearHighlights();

      const correctAnswers = findCorrectAnswers(question.text, savedAnswers);
      if (correctAnswers.length === 0) {
        showNotification('⚠️ Вопрос не в базе — ответь вручную');
        await sleep(5000);
        continue;
      }
      console.log('[НМО] Правильные ответы в базе:', correctAnswers.map(c => c.text));

      // Автовыбор: радио (один лучший) + чекбоксы (все совпавшие)
      const applyResult = await applyAnswers(question, correctAnswers);

      // Подсветка — после кликов, чтобы ✅ не сломал текстовый матчинг
      highlightAnswers(question, correctAnswers, applyResult.selected);

      if (!applyResult.found || !applyResult.allOk) {
        const mode = await waitForManualOrSkip(question, correctAnswers, applyResult.found);
        if (mode === 'changed') continue;
        if (mode !== 'checked') {
          showNotification('⏹ Авто остановлен');
          break;
        }
      } else {
        showNotification('✅ Ответы выбраны');
      }

      // Последний вопрос: ответы выбраны — НИЧЕГО не нажимаем
      if (isFinalState(question)) {
        showNotification(
          '🏁 Последний вопрос (' + question.currentNum + ' из ' + question.totalNum +
          ')! Ответы выбраны, авторежим остановлен. «Завершить тест» НЕ нажат — жми вручную, когда готов.',
          20000
        );
        break;
      }

      // Если вопрос уже сменился (пользователь переключил сам) — начинаем заново
      const nowQ = getCurrentQuestion();
      if (!nowQ || nowQ.key !== question.key) continue;

      await clickNextAndWait(question, attempts);
    }

    autoMode = false;
    updateAutoButton();
  }

  // Ответить только на текущий вопрос (кнопка из popup, без перехода)
  async function answerCurrentQuestion() {
    const result = await browser.storage.local.get('nmoAnswers');
    const savedAnswers = result.nmoAnswers || [];
    if (!savedAnswers.length) {
      showNotification('❌ Нет сохранённых ответов');
      return;
    }

    const question = getCurrentQuestion();
    if (!question) {
      showNotification('❌ Вопрос не найден');
      return;
    }

    clearHighlights();

    const correctAnswers = findCorrectAnswers(question.text, savedAnswers);
    if (correctAnswers.length === 0) {
      showNotification('⚠️ Вопрос не в базе');
      return;
    }

    const applyResult = await applyAnswers(question, correctAnswers);
    highlightAnswers(question, correctAnswers, applyResult.selected);

    if (!applyResult.found || !applyResult.allOk) {
      const mode = await waitForManualOrSkip(question, correctAnswers, applyResult.found);
      if (mode === 'timeout' || mode === 'stopped') {
        showNotification('⏳ Ожидание ручной отметки остановлено');
      }
    } else {
      showNotification('✅ Ответы выбраны');
    }
  }

  function stopAutoMode() {
    autoMode = false;
    updateAutoButton();
    clearHighlights();
    showNotification('⏹ Авто остановлен');
  }

  function showNotification(message, duration = 5000) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:20px;right:20px;background:#4CAF50;color:white;padding:15px 20px;border-radius:8px;z-index:10000;font-family:Arial;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    div.textContent = message;
    document.body.appendChild(div);
    if (duration > 0) setTimeout(() => div.remove(), duration);
    return div;
  }

  function updateAutoButton() {
    const autoBtn = document.getElementById('nmo-btn-auto');
    const stopBtn = document.getElementById('nmo-btn-stop');
    if (autoMode) {
      if (autoBtn) { autoBtn.textContent = '🤖 Работает...'; autoBtn.style.background = '#FF9800'; autoBtn.disabled = true; }
      if (stopBtn) stopBtn.style.display = 'block';
    } else {
      if (autoBtn) { autoBtn.textContent = '🤖 Авто'; autoBtn.style.background = '#FF9800'; autoBtn.disabled = false; }
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }

  function addButtons() {
    // Кнопка "Поиск на РосМедИнфо"
    const searchBtn = document.createElement('button');
    searchBtn.id = 'nmo-btn-search';
    searchBtn.textContent = '🔍 РосМедИнфо';
    searchBtn.style.cssText = 'position:fixed;bottom:20px;right:180px;background:#2196F3;color:white;border:none;padding:12px 16px;border-radius:8px;cursor:pointer;z-index:10000;font-size:13px;';
    searchBtn.onclick = () => {
      const testName = getTestName();
      console.log('[НМО] Отправляем на поиск:', testName);
      showNotification(`🔍 Ищем: ${testName.substring(0, 50)}...`);
      browser.runtime.sendMessage({
        action: 'openSearchBackground',
        testName: testName
      }).then(response => {
        console.log('[НМО] Ответ от background:', response);
        if (response?.success) {
          showNotification(response.clicked ? '✅ Найдено и открыто!' : '🔍 Поиск открыт, выбери вручную');
        } else {
          showNotification('❌ ' + (response?.error || 'Ошибка'));
        }
      });
    };
    document.body.appendChild(searchBtn);

    // Основная кнопка "Авто"
    const autoBtn = document.createElement('button');
    autoBtn.id = 'nmo-btn-auto';
    autoBtn.textContent = '🤖 Авто';
    autoBtn.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#FF9800;color:white;border:none;padding:12px 20px;border-radius:8px;cursor:pointer;z-index:10000;font-size:14px;';
    autoBtn.onclick = () => autoMode ? stopAutoMode() : autoAnswerLoop();
    document.body.appendChild(autoBtn);

    const stopBtn = document.createElement('button');
    stopBtn.id = 'nmo-btn-stop';
    stopBtn.textContent = '⏹ Стоп';
    stopBtn.style.cssText = 'position:fixed;bottom:75px;right:20px;background:#f44336;color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;z-index:10000;font-size:13px;display:none;';
    stopBtn.onclick = stopAutoMode;
    document.body.appendChild(stopBtn);
  }

  function getTestName() {
    // 1. Заголовок теста в карточке (Angular Material)
    const quizTitle = document.querySelector('.mat-card-title-quiz-custom, .quiz-info-col mat-card-title, [class*="quiz"][class*="title"]');
    if (quizTitle && quizTitle.textContent.trim().length > 5) {
      return quizTitle.textContent.trim();
    }
    // 2. Старые селекторы (Vaadin)
    const titleEl = document.querySelector('.v-label-h2, .v-label-bold, .v-label.v-label-h2, h1, h2');
    if (titleEl && titleEl.textContent.trim().length > 5) {
      return titleEl.textContent.trim();
    }
    // 3. Текст первого вопроса
    const firstQuestion = document.querySelector('.question-title-text');
    if (firstQuestion) return firstQuestion.textContent.trim();
    // 4. Title страницы
    return document.title.replace(/^.*?[-|:]\s*/, '').trim();
  }

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .nmo-correct-indicator { animation: pulse 1.5s infinite; }
  `;
  document.head.appendChild(style);

  browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startAuto') {
      if (!autoMode) autoAnswerLoop();
      sendResponse({ success: true });
    } else if (request.action === 'stopAuto') {
      stopAutoMode();
      sendResponse({ success: true });
    } else if (request.action === 'getAutoStatus') {
      sendResponse({ autoMode });
    } else if (request.action === 'answerCurrent') {
      answerCurrentQuestion();
      sendResponse({ success: true });
    }
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButtons);
  } else {
    addButtons();
  }
})();
