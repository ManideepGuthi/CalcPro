document.addEventListener('DOMContentLoaded', () => {
  const display = document.getElementById('calc-display');
  const keys = document.querySelectorAll('#calc [data-key]');
  const clearBtn = document.getElementById('calc-clear');
  const equalsBtn = document.getElementById('calc-equals');
  const historyList = document.getElementById('history');
  const aiToggle = document.getElementById('aiToggle');
  const micBtn = document.getElementById('micBtn');
  const clearHistoryBtn = document.getElementById('clearHistory');

  let expr = '';

  function render() {
    display.value = expr;
  }

  keys.forEach((btn) => {
    btn.addEventListener('click', () => {
      expr += btn.getAttribute('data-key');
      render();
    });
  });

  clearBtn?.addEventListener('click', () => {
    expr = '';
    render();
  });

  equalsBtn?.addEventListener('click', async () => {
    if (!expr) return;
    try {
      const res = await fetch('/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: expr, ai: aiToggle?.checked })
      });
      const data = await res.json();
      if (data.ok) {
        const evaluatedExpression = expr;
        expr = String(data.result);
        render();
        // prepend to history
        if (historyList) {
          const li = document.createElement('li');
          li.className = 'list-group-item bg-black text-light d-flex justify-content-between';
          li.innerHTML = `<span>${evaluatedExpression} =</span><strong>${data.result}</strong>`;
          historyList.prepend(li);
          if (data.steps && data.steps.length) {
            const liSteps = document.createElement('li');
            liSteps.className = 'list-group-item bg-black text-light';
            const ol = document.createElement('ol');
            ol.className = 'mb-0 ps-3';
            data.steps.forEach(s => {
              const item = document.createElement('li');
              item.textContent = s;
              ol.appendChild(item);
            });
            liSteps.appendChild(ol);
            historyList.prepend(liSteps);
          }
        }
      } else {
        alert(data.error || 'Error');
      }
    } catch (e) {
      alert('Network error');
    }
  });

  // Keyboard support
  document.addEventListener('keydown', (e) => {
    const key = e.key;
    if (/^[0-9]$/.test(key)) {
      expr += key;
      render();
      return;
    }
    if (['+', '-', '*', '/', '%', '.','(',')'].includes(key)) {
      expr += key;
      render();
      return;
    }
    if (key === 'Enter' || key === '=') {
      e.preventDefault();
      equalsBtn?.click();
      return;
    }
    if (key === 'Backspace') {
      expr = expr.slice(0, -1);
      render();
      return;
    }
    if (key === 'Escape') {
      expr = '';
      render();
      return;
    }
  });

  // Voice input (Web Speech API where available)
  // Mic start/stop with simple viz
  let rec = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micViz = document.getElementById('micViz');
  const micStatus = document.getElementById('micStatus');
  function setListening(on) {
    micBtn.textContent = on ? 'Stop mic ⏹' : 'Start mic 🎤';
    micViz?.classList.toggle('d-none', !on);
    if (micStatus) micStatus.textContent = on ? 'Listening… speak now' : 'Type or speak your expression';
  }
  micBtn?.addEventListener('click', () => {
    if (!SR) { alert('Speech recognition not supported in this browser'); return; }
    if (rec) {
      rec.stop();
      rec = null;
      setListening(false);
      return;
    }
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onend = () => { setListening(false); rec = null; };
    rec.onerror = () => { setListening(false); rec = null; };
    rec.onresult = (event) => {
      // final result
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const said = res[0].transcript;
        if (res.isFinal) {
          if (expr && !expr.endsWith(' ')) expr += ' ';
          expr += said;
          render();
        }
      }
    };
    rec.start();
  });

  // Delete single history item
  historyList?.addEventListener('click', async (e) => {
    const target = e.target;
    if (target instanceof HTMLElement) {
      const id = target.getAttribute('data-delete');
      if (id) {
        try {
          const res = await fetch(`/history/${id}`, { method: 'DELETE' });
          if (res.ok) {
            const li = target.closest('li');
            li?.remove();
          }
        } catch (_) {}
      }
    }
  });

  // Clear full history
  clearHistoryBtn?.addEventListener('click', async () => {
    if (!confirm('Clear entire history?')) return;
    try {
      const res = await fetch('/history/clear', { method: 'POST' });
      if (res.ok && historyList) {
        historyList.innerHTML = '<li class="list-group-item bg-black text-light">No history yet.</li>';
      }
    } catch (_) {}
  });
});


