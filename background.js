// Background скрипт для расширения НМО Автоответчик

browser.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    console.log('[НМО BG] Расширение установлено');
  }
});

browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('[НМО BG] Получено сообщение:', request.action, request);
  
  if (request.action === 'getAnswers') {
    browser.storage.local.get('nmoAnswers').then(function(result) {
      sendResponse({ answers: result.nmoAnswers || [] });
    });
    return true;
  } else if (request.action === 'openSearch') {
    console.log('[НМО BG] Открываем поиск (активная вкладка):', request.testName);
    const url = `https://rosmedicinfo.ru/index.php?do=search&subaction=search&story=${encodeURIComponent(request.testName)}`;
    
    browser.tabs.create({ url: url, active: true }).then(tab => {
      console.log('[НМО BG] Вкладка открыта:', tab.id);
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          browser.tabs.onUpdated.removeListener(listener);
          console.log('[НМО BG] Вкладка загружена, ищем ссылку...');
          browser.tabs.executeScript(tab.id, {
            code: findAndClickResult.toString() + `\nfindAndClickResult(${JSON.stringify(request.testName)});`
          }).then(result => {
            console.log('[НМО BG] executeScript результат:', result);
            sendResponse({ success: true, clicked: result?.[0] });
          }).catch(err => {
            console.error('[НМО BG] Ошибка executeScript:', err);
            sendResponse({ success: false, error: err.message });
          });
        }
      };
      browser.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        browser.tabs.onUpdated.removeListener(listener);
        sendResponse({ success: false, error: 'Timeout' });
      }, 15000);
    }).catch(err => {
      console.error('[НМО BG] Ошибка открытия вкладки:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  } else if (request.action === 'openSearchBackground') {
    console.log('[НМО BG] Открываем поиск в фоне:', request.testName);
    const url = `https://rosmedicinfo.ru/index.php?do=search&subaction=search&story=${encodeURIComponent(request.testName)}`;
    
    // Открываем в НЕактивной вкладке (НЕ закрываем автоматически)
    browser.tabs.create({ url: url, active: false }).then(tab => {
      console.log('[НМО BG] Фоновая вкладка открыта:', tab.id);
      
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          browser.tabs.onUpdated.removeListener(listener);
          console.log('[НМО BG] Фоновая вкладка загружена, ищем ссылку...');
          browser.tabs.executeScript(tab.id, {
            code: findAndClickResult.toString() + `\nfindAndClickResult(${JSON.stringify(request.testName)});`
          }).then(result => {
            console.log('[НМО BG] executeScript результат:', result);
            // НЕ закрываем вкладку — пусть пользователь видит результат
            sendResponse({ success: true, clicked: result?.[0], tabId: tab.id });
          }).catch(err => {
            console.error('[НМО BG] Ошибка executeScript:', err);
            sendResponse({ success: false, error: err.message });
          });
        }
      };
      browser.tabs.onUpdated.addListener(listener);
      
      setTimeout(() => {
        browser.tabs.onUpdated.removeListener(listener);
        sendResponse({ success: false, error: 'Timeout' });
      }, 15000);
      
    }).catch(err => {
      console.error('[НМО BG] Ошибка открытия вкладки:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

// Функция для поиска и клика по нужной ссылке
function findAndClickResult(testName) {
  console.log('[НМО SEARCH] Ищем в результатах:', testName);
  
  // Нормализуем название для сравнения
  const normalize = (str) => str.toLowerCase()
    .replace(/[«»"']/g, '')
    .replace(/ответы к тестам нмо[:]\s*/i, '')
    .replace(/ответы на тесты нмо[:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const target = normalize(testName);
  console.log('[НМО SEARCH] Нормализованное имя:', target);
  
  // Ищем все ссылки в результатах поиска (структура rosmedicinfo.ru)
  const links = document.querySelectorAll('h2 a, .short__title a, .search-result a, h3 a, .title a, a[href*="answers-to-nmo-tests"]');
  console.log('[НМО SEARCH] Найдено ссылок:', links.length);
  
  let bestMatch = null;
  let bestScore = 0;
  
  links.forEach((link, i) => {
    const text = link.textContent.trim();
    const normalized = normalize(text);
    
    // Считаем совпадение слов
    const targetWords = target.split(' ').filter(w => w.length > 3);
    let score = 0;
    targetWords.forEach(word => {
      if (normalized.includes(word)) score++;
    });
    
    // Бонус если есть "ответ" в тексте
    if (normalized.includes('ответ')) score += 2;
    
    console.log(`[НМО SEARCH] ${i}: "${text.substring(0, 80)}" -> score: ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = link;
    }
  });
  
  if (bestMatch && bestScore >= 3) {
    console.log('[НМО SEARCH] Лучшее совпадение:', bestMatch.textContent.trim().substring(0, 100), 'score:', bestScore);
    bestMatch.click();
    return true;
  } else {
    console.log('[НМО SEARCH] Совпадений нет, score < 3');
    return false;
  }
}