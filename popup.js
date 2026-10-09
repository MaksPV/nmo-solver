document.addEventListener('DOMContentLoaded', function() {
  const statusDiv = document.getElementById('status');
  const btnAnswer = document.getElementById('btnAnswer');
  const btnAuto = document.getElementById('btnAuto');
  const btnStop = document.getElementById('btnStop');
  const btnParse = document.getElementById('btnParse');

  updateStatus();
  updateAutoUI();

  async function updateStatus() {
    try {
      const result = await browser.storage.local.get('nmoAnswers');
      const count = (result.nmoAnswers || []).length;
      
      if (count > 0) {
        statusDiv.className = 'status ok';
        statusDiv.textContent = `✅ Сохранено ${count} вопросов с ответами`;
      } else {
        statusDiv.className = 'status error';
        statusDiv.textContent = '❌ Нет сохранённых ответов';
      }
    } catch (err) {
      statusDiv.className = 'status error';
      statusDiv.textContent = '❌ Ошибка: ' + err.message;
    }
  }

  function updateAutoUI() {
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs.length === 0) return;
      browser.tabs.sendMessage(tabs[0].id, { action: 'getAutoStatus' }).then(response => {
        if (response && response.autoMode) {
          btnAuto.textContent = '🤖 Работает...';
          btnAuto.disabled = true;
          btnAuto.style.background = '#FF9800';
          btnStop.style.display = 'block';
        } else {
          btnAuto.textContent = '🤖 Авто режим';
          btnAuto.disabled = false;
          btnAuto.style.background = '#2196F3';
          btnStop.style.display = 'none';
        }
      }).catch(() => {});
    });
  }

  btnAnswer.addEventListener('click', async function() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    
    browser.tabs.sendMessage(tabs[0].id, { action: 'answerCurrent' }).then(response => {
      if (response && response.success) {
        btnAnswer.textContent = '✅ Ответ выбран!';
        setTimeout(() => { btnAnswer.textContent = '✅ Ответить на текущий'; }, 2000);
      }
    }).catch(err => {
      btnAnswer.textContent = '❌ Ошибка';
      setTimeout(() => { btnAnswer.textContent = '✅ Ответить на текущий'; }, 2000);
    });
  });

  btnAuto.addEventListener('click', async function() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    
    browser.tabs.sendMessage(tabs[0].id, { action: 'startAuto' }).then(response => {
      if (response && response.success) {
        btnAuto.textContent = '🤖 Работает...';
        btnAuto.disabled = true;
        btnAuto.style.background = '#FF9800';
        btnStop.style.display = 'block';
      }
    }).catch(err => {
      btnAuto.textContent = '❌ Ошибка';
      setTimeout(() => { 
        btnAuto.textContent = '🤖 Авто режим';
        btnAuto.disabled = false;
        btnAuto.style.background = '#2196F3';
      }, 2000);
    });
  });

  btnStop.addEventListener('click', async function() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    
    browser.tabs.sendMessage(tabs[0].id, { action: 'stopAuto' }).then(response => {
      if (response && response.success) {
        btnAuto.textContent = '🤖 Авто режим';
        btnAuto.disabled = false;
        btnAuto.style.background = '#2196F3';
        btnStop.style.display = 'none';
      }
    }).catch(() => {});
  });

  btnParse.addEventListener('click', async function() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    
    browser.tabs.sendMessage(tabs[0].id, { action: 'parseAndSave' }).then(response => {
      if (response && response.success) {
        btnParse.textContent = `✅ Сохранено ${response.count} вопросов!`;
        setTimeout(() => { btnParse.textContent = '📄 Парсить текущую страницу с ответами'; }, 2000);
        updateStatus();
      }
    }).catch(err => {
      btnParse.textContent = '❌ Ошибка';
      setTimeout(() => { btnParse.textContent = '📄 Парсить текущую страницу с ответами'; }, 2000);
    });
  });

  // Периодически обновляем статус авторежима
  setInterval(updateAutoUI, 2000);
});