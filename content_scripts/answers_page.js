// Скрипт для страницы с ответами (РосМедИнфо) + поиск тестов
(function() {
  'use strict';

  // Парсер страницы с ответами
  function parseAnswersPage() {
    const questions = [];
    const h3Elements = document.querySelectorAll('.page__text h3');
    
    h3Elements.forEach((h3, index) => {
      const questionText = h3.textContent.trim();
      let nextElement = h3.nextElementSibling;
      while (nextElement && nextElement.tagName !== 'P') {
        nextElement = nextElement.nextElementSibling;
      }
      if (!nextElement) return;
      
      const answers = [];
      const answerElements = nextElement.querySelectorAll('span[style*="fbeeb8"]');
      
      if (answerElements.length === 0) {
        const allSpans = nextElement.querySelectorAll('span');
        allSpans.forEach(span => {
          const text = span.textContent.trim();
          if (text && /^\d+\)/.test(text)) {
            const isCorrect = span.style.backgroundColor === 'rgb(251, 238, 184)' || 
                              span.style.backgroundColor === '#fbeeb8' ||
                              span.getAttribute('style')?.includes('fbeeb8');
            answers.push({ text, isCorrect });
          }
        });
      } else {
        answerElements.forEach(span => {
          const text = span.textContent.trim();
          if (text) answers.push({ text, isCorrect: true });
        });
      }
      
      if (answers.length === 0) {
        const html = nextElement.innerHTML;
        const parts = html.split(/<br\s*\/?>/i);
        parts.forEach(part => {
          const clean = part.replace(/<[^>]*>/g, '').trim();
          if (clean && /^\d+\)/.test(clean)) {
            answers.push({ text: clean, isCorrect: part.includes('fbeeb8') });
          }
        });
      }
      
      if (answers.length > 0) {
        questions.push({ number: index + 1, question: questionText, answers });
      }
    });
    
    return questions;
  }

  // Сохранение ответов
  function saveAnswers(questions) {
    browser.storage.local.set({
      nmoAnswers: questions,
      nmoAnswersUrl: window.location.href,
      nmoAnswersDate: new Date().toISOString()
    }).then(() => {
      console.log('[НМО] Сохранено:', questions.length, 'вопросов');
      showNotification(`✅ Сохранено ${questions.length} вопросов!`);
    });
  }

  function showNotification(message) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:20px;right:20px;background:#4CAF50;color:white;padding:15px 20px;border-radius:8px;z-index:10000;font-family:Arial;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }

  // Автопарсинг при загрузке страницы ответов
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const questions = parseAnswersPage();
      if (questions.length > 0) saveAnswers(questions);
    });
  } else {
    const questions = parseAnswersPage();
    if (questions.length > 0) saveAnswers(questions);
  }

  // Слушаем сообщения
  browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getAnswers') {
      const questions = parseAnswersPage();
      sendResponse({ questions });
    } else if (request.action === 'parseAndSave') {
      const questions = parseAnswersPage();
      saveAnswers(questions);
      sendResponse({ success: true, count: questions.length });
    } else if (request.action === 'searchTest') {
      // Поиск теста на сайте
      searchTestOnRosmedinfo(request.testName).then(result => {
        sendResponse({ success: true, url: result });
      });
      return true;
    }
    return true;
  });

  // Поиск теста на rosmedinfo.ru
  async function searchTestOnRosmedinfo(testName) {
    const searchInput = document.querySelector('.search-block__input#story') || 
                        document.querySelector('input[name="story"]') ||
                        document.querySelector('input[placeholder*="Поиск"]');
    
    if (!searchInput) {
      // Если нет поиска на странице — переходим на главную и ищем
      window.location.href = `https://rosmedicinfo.ru/index.php?do=search&subaction=search&story=${encodeURIComponent(testName)}`;
      return;
    }
    
    searchInput.value = testName;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Ждём и сабмитим форму
    await new Promise(r => setTimeout(r, 300));
    
    const form = searchInput.closest('form');
    if (form) {
      form.submit();
    } else {
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }
  }
})();