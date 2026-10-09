// Скрипт для страницы теста (QuizLib)
(function() {
  'use strict';

  function normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/[«»"']/g, '')
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

  function getCurrentQuestion() {
    const questionCard = document.querySelector('.question');
    if (!questionCard) return null;

    const titleElement = questionCard.querySelector('.question-title-text');
    if (!titleElement) return null;

    const radioButtons = questionCard.querySelectorAll('mat-radio-button.radio-button_answer');
    const checkboxes = questionCard.querySelectorAll('mat-checkbox');

    const answers = [];

    if (radioButtons.length > 0) {
      radioButtons.forEach(rb => {
        const input = rb.querySelector('input[type="radio"]');
        const label = rb.querySelector('label');
        answers.push({ element: rb, input: input, text: label ? label.textContent.trim() : '', type: 'radio' });
      });
    } else if (checkboxes.length > 0) {
      checkboxes.forEach(cb => {
        const input = cb.querySelector('input[type="checkbox"]');
        const label = cb.querySelector('label');
        answers.push({ element: cb, input: input, text: label ? label.textContent.trim() : '', type: 'checkbox' });
      });
    }

    const counterEl = questionCard.querySelector('.question-info-questionCounter');
    let currentNum = 0, totalNum = 0;
    if (counterEl) {
      const match = counterEl.textContent.match(/Вопрос\s+(\d+)\s+из\s+(\d+)/i);
      if (match) {
        currentNum = parseInt(match[1]);
        totalNum = parseInt(match[2]);
      }
    }

    return {
      text: titleElement.textContent.trim(),
      answers: answers,
      isMulti: checkboxes.length > 0,
      currentNum: currentNum,
      totalNum: totalNum,
      isLastQuestion: currentNum > 0 && currentNum === totalNum
    };
  }

  function findCorrectAnswers(questionText, savedAnswers) {
    const normalizedQuestion = normalizeText(questionText);

    for (const saved of savedAnswers) {
      const savedQuestion = normalizeText(saved.question);
      if (normalizedQuestion.includes(savedQuestion) || savedQuestion.includes(normalizedQuestion)) {
        return saved.answers.filter(a => a.isCorrect);
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

  // Подсветка ТОЛЬКО для чекбоксов
  function highlightCheckboxes(question, correctAnswers) {
    const correctTexts = correctAnswers.map(c => normalizeText(c.text));
    let highlighted = 0;

    for (const answer of question.answers) {
      if (answer.type !== 'checkbox') continue; // ТОЛЬКО чекбоксы

      const normalizedAnswer = normalizeText(answer.text);
      let isCorrect = false;

      for (const correctText of correctTexts) {
        if (normalizedAnswer.includes(correctText) || 
            correctText.includes(normalizedAnswer) || 
            similarity(normalizedAnswer, correctText) > 0.75) {
          isCorrect = true;
          break;
        }
      }

      if (!isCorrect) continue;

      // Убираем старую подсветку
      answer.element.style.removeProperty('border');
      answer.element.style.removeProperty('box-shadow');
      answer.element.style.removeProperty('background');
      answer.element.style.removeProperty('transition');
      answer.element.style.removeProperty('borderRadius');
      answer.element.style.removeProperty('padding');
      
      // Добавляем индикатор ✅ если его нет
      if (!answer.element.querySelector('.nmo-correct-indicator')) {
        const indicator = document.createElement('span');
        indicator.className = 'nmo-correct-indicator';
        indicator.textContent = ' ✅';
        indicator.style.cssText = 'margin-left:8px;color:#4CAF50;font-weight:bold;font-size:14px;animation:pulse 1s infinite;';
        const label = answer.element.querySelector('label');
        if (label) label.appendChild(indicator);
      }

      // Подсветка компонента
      answer.element.style.border = '2px solid #4CAF50';
      answer.element.style.boxShadow = '0 0 8px rgba(76,175,80,0.5)';
      answer.element.style.background = 'rgba(76,175,80,0.08)';
      answer.element.style.transition = 'all 0.3s';
      answer.element.style.borderRadius = '8px';
      answer.element.style.padding = '4px';
      highlighted++;
    }
    return highlighted;
  }

  function clearHighlights(question) {
    if (!question) return;
    for (const answer of question.answers) {
      answer.element.style.removeProperty('border');
      answer.element.style.removeProperty('box-shadow');
      answer.element.style.removeProperty('background');
      answer.element.style.removeProperty('transition');
      answer.element.style.removeProperty('borderRadius');
      answer.element.style.removeProperty('padding');
      const indicator = answer.element.querySelector('.nmo-correct-indicator');
      if (indicator) indicator.remove();
    }
  }

  // Авто-выбор для радио, подсветка для чекбоксов
  async function selectAnswer(question, correctAnswers) {
    let selected = 0;

    const correctTexts = correctAnswers.map(c => normalizeText(c.text));
    console.log('[НМО] Ищем совпадения для:', correctTexts);

    // Подсвечиваем чекбоксы
    highlightCheckboxes(question, correctAnswers);

    for (const answer of question.answers) {
      const normalizedAnswer = normalizeText(answer.text);
      console.log('[НМО] Проверяем ответ:', normalizedAnswer);

      let isCorrect = false;
      for (const correctText of correctTexts) {
        if (normalizedAnswer.includes(correctText) || 
            correctText.includes(normalizedAnswer) || 
            similarity(normalizedAnswer, correctText) > 0.75) {
          isCorrect = true;
          break;
        }
      }

      if (!isCorrect) continue;

      console.log('[НМО] ✅ Совпало:', normalizedAnswer);

      if (answer.type === 'radio') {
        // Радиокнопки — авто-выбор
        if (answer.input) {
          if (answer.input.checked) {
            console.log('[НМО] Уже отмечен');
            selected++;
            continue;
          }
          answer.input.checked = true;
          answer.input.dispatchEvent(new Event('change', { bubbles: true }));
          answer.input.dispatchEvent(new Event('input', { bubbles: true }));
          answer.input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await sleep(100);
          if (answer.input.checked) {
            console.log('[НМО] Радиокнопка выбрана');
            selected++;
          }
        }
      } else if (answer.type === 'checkbox') {
        // Чекбоксы — НЕ кликаем, только подсветили выше
        console.log('[НМО] Чекбокс подсвечен, ждём клика пользователя');
      }
    }

    return selected > 0 || highlightCheckboxes(question, correctAnswers) > 0;
  }

  function getNextButton() {
    return document.querySelector('button.question-buttons-primary') ||
           document.querySelector('button[mat-raised-button].question-buttons-primary') ||
           Array.from(document.querySelectorAll('button')).find(b => 
             b.textContent.includes('Следующий') || b.textContent.includes('Далее')
           );
  }

  function isTestFinished(question) {
    if (question && question.isLastQuestion) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        if (text.includes('завершить') || text.includes('отправить') || text.includes('закончить')) {
          return true;
        }
      }
    }
    const resultScreen = document.querySelector('.result-screen, .test-finished, .quiz-result, [class*="result"]');
    return !!resultScreen;
  }

  let autoMode = false;

  async function autoAnswerLoop() {
    autoMode = true;
    updateAutoButton();

    while (autoMode) {
      const result = await browser.storage.local.get('nmoAnswers');
      const savedAnswers = result.nmoAnswers || [];
      if (savedAnswers.length === 0) {
        showNotification('❌ Нет сохранённых ответов');
        break;
      }

      const question = getCurrentQuestion();
      if (!question) {
        showNotification('❌ Вопрос не найден');
        break;
      }

      clearHighlights(question);

      const correctAnswers = findCorrectAnswers(question.text, savedAnswers);
      if (correctAnswers.length === 0) {
        showNotification('⚠️ Вопрос не в базе, жду...');
        await sleep(3000);
        continue;
      }

      const success = await selectAnswer(question, correctAnswers);
      if (!success) {
        showNotification('⚠️ Не удалось найти ответы');
        await sleep(2000);
        continue;
      }

      const checkboxCount = question.answers.filter(a => a.type === 'checkbox' && a.element.querySelector('.nmo-correct-indicator')).length;
      const radioCount = question.answers.filter(a => a.type === 'radio' && a.input?.checked).length;
      showNotification(`🟢 Радио выбрано: ${radioCount}, чекбоксов подсвечено: ${checkboxCount}. Кликай чекбоксы →`);

      // АВТО-переход на следующий вопрос
      await sleep(1000);
      const nextBtn = getNextButton();
      if (nextBtn && !nextBtn.disabled) {
        // Ждём, пока пользователь кликнет подсвеченные чекбоксы (проверяем каждые 500мс)
        let userClicked = false;
        let attempts = 0;
        while (autoMode && attempts < 60) { // макс 30 сек
          await sleep(500);
          attempts++;
          
          // Проверяем, все ли подсвеченные чекбоксы отмечены
          const allHighlightedChecked = question.answers
            .filter(a => a.type === 'checkbox' && a.element.querySelector('.nmo-correct-indicator'))
            .every(a => a.input?.checked);
          
          if (allHighlightedChecked) {
            userClicked = true;
            break;
          }
        }
        
        if (!userClicked) {
          showNotification('⏳ Жду клика чекбоксов...');
          // Ждём ещё
          while (autoMode) {
            await sleep(500);
            const allHighlightedChecked = question.answers
              .filter(a => a.type === 'checkbox' && a.element.querySelector('.nmo-correct-indicator'))
              .every(a => a.input?.checked);
            if (allHighlightedChecked) break;
          }
        }

        if (!autoMode) break;

        nextBtn.click();
        showNotification('➡️ Следующий...');
        await sleep(1500);
      } else if (isTestFinished(question)) {
        showNotification('🏁 Тест завершён!');
        break;
      } else {
        showNotification('⚠️ Кнопка "Следующий" не найдена');
        break;
      }
    }

    autoMode = false;
    updateAutoButton();
  }

  function stopAutoMode() {
    autoMode = false;
    updateAutoButton();
    const question = getCurrentQuestion();
    if (question) clearHighlights(question);
    showNotification('⏹ Авто остановлен');
  }

  function showNotification(message) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:20px;right:20px;background:#4CAF50;color:white;padding:15px 20px;border-radius:8px;z-index:10000;font-family:Arial;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
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
    }
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButtons);
  } else {
    addButtons();
  }
})();