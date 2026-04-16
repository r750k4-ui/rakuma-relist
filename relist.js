/*!
 * ã©ã¯ãååºåãã¼ã« v2.0
 * https://github.com/r750k4-ui/rakuma-relist
 *
 * fril.jpä¸ã§ããã¯ãã¼ã¯ã¬ããããèµ·åãã¦ä½¿ç¨ãã¾ãã
 * localStorageãä½¿ã£ã¦ãã¼ã¸ãã¾ããã§ç¶æãç®¡çãã¾ãã
 */
(function () {
  'use strict';

  if (!location.hostname.includes('fril.jp')) {
    alert('ãã®ãã¼ã«ã¯fril.jpï¼ã©ã¯ãï¼ã®ãã¼ã¸ã§èµ·åãã¦ãã ããã');
    return;
  }

  const STORAGE_KEY = 'rakuma_relist_job';

  // ============================================================
  // ã¦ã¼ãã£ãªãã£
  // ============================================================

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function waitFor(selector, timeout) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout || 10000);
    });
  }

  // Reactç®¡çãã©ã¼ã ã¸ã®å¤è¨­å®ï¼åä¸ã¦ã£ã³ãã¦ãªã®ã§åé¡ãªãï¼
  function setInput(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setTextarea(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setSelect(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ç»åURLãfile inputã«ã¢ããã­ã¼ã
  async function uploadImageFromUrl(fileInput, url) {
    const filename = url.split('/').pop().split('?')[0] || 'image.jpg';
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ============================================================
  // ã¸ã§ãç®¡çï¼localStorageï¼
  // ============================================================

  function getJob() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
    catch (e) { return null; }
  }
  function saveJob(job) { localStorage.setItem(STORAGE_KEY, JSON.stringify(job)); }
  function clearJob() { localStorage.removeItem(STORAGE_KEY); }

  // ============================================================
  // /sell ãã¼ã¸ï¼åºåä¸­ååãªã¹ãåå¾
  // ============================================================

  async function fetchSellItems() {
    const items = [];
    try {
      for (let page = 1; page <= 10; page++) {
        const res = await fetch('/api/sell_items?page=' + page + '&per_page=30', {
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include'
        });
        if (!res.ok) break;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) break;
        const json = await res.json();
        const list = json.items || json.user_items || json.data || [];
        if (list.length === 0) break;
        for (const item of list) {
          const id = item.id || item.item_id;
          if (!id) continue;
          items.push({
            id: String(id),
            title: (item.title || item.name || '').substring(0, 50),
            thumb: item.thumbnail_url || item.image_url || ''
          });
        }
        if (!json.has_next && !json.next_page) break;
      }
    } catch (e) {
      console.log('[rakuma-relist] APIåå¾ã¨ã©ã¼:', e.message);
    }
    return items;
  }

  // ============================================================
  // /item/{id}/edit ãã¼ã¸ï¼ç¾å¨ãã¼ã¸ãããã¼ã¿æ½åº
  // ============================================================

  function extractCurrentItemData(id) {
    const selects = document.querySelectorAll('select');
    const buttons = [...document.querySelectorAll('button')];

    const categoryBtn = buttons.find(b =>
      b.textContent.includes('>') || b.closest('[class*="category"]')
    );
    const brandBtn = buttons.find(b => b.closest('[class*="brand"]'));
    const shippingMethodBtn = buttons.find(b =>
      b.closest('[class*="shipping-method"], [class*="shippingMethod"]') ||
      b.textContent.includes('éé') || b.textContent.includes('ã¤ãã') ||
      b.textContent.includes('å®æ¥ä¾¿') || b.textContent.includes('ãããã')
    );

    const images = [...document.querySelectorAll('img[src*="fril.jp/img"]')]
      .map(img => img.src.replace('/m/', '/l/').replace(/\?.*$/, ''))
      .filter((url, i, arr) => url && arr.indexOf(url) === i);

    return {
      id,
      title: document.querySelector('[placeholder="40æå­ã¾ã§"]')?.value || '',
      description: document.querySelector('textarea')?.value || '',
      price: document.querySelector('[placeholder*="300"], [placeholder*="å"]')?.value || '',
      condition: selects[0]?.value || '',
      shippingPayer: selects[1]?.value || '',
      shippingDays: selects[2]?.value || '',
      shippingOrigin: selects[3]?.value || '',
      purchaseRequest: selects[4]?.value || '',
      images,
      categoryPath: categoryBtn?.textContent.trim() || '',
      brandName: brandBtn?.textContent.trim() || '',
      shippingMethod: shippingMethodBtn?.textContent.trim() || '',
    };
  }

  // ============================================================
  // /item/new ãã¼ã¸ï¼ãã©ã¼ã èªåå¥åï¼åä¸ã¦ã£ã³ãã¦ã§å®è¡ï¼
  // ============================================================

  async function fillNewItemForm(itemData) {
    log('ãã©ã¼ã å¥åéå§: ' + itemData.title.substring(0, 20));

    // ã¿ã¤ãã«å¥åæ¬ãç¾ããã¾ã§å¾ã¤ï¼æå¤§20ç§ï¼
    let titleInput;
    try {
      titleInput = await waitFor('[placeholder="40æå­ã¾ã§"], [placeholder*="ååå"], [maxlength="40"]', 20000);
    } catch (e) {
      log('â ã¿ã¤ãã«å¥åæ¬ãè¦ã¤ããã¾ãã');
      return false;
    }

    try {
      log('ã¿ã¤ãã«å¥åä¸­...');
      setInput(titleInput, itemData.title);
      await sleep(400);

      const priceInput = document.querySelector('[placeholder*="300"], [placeholder*="å"], [placeholder*="éé¡"]');
      if (priceInput && itemData.price) setInput(priceInput, itemData.price);
      await sleep(200);

      const textarea = document.querySelector('textarea');
      if (textarea && itemData.description) setTextarea(textarea, itemData.description);
      await sleep(200);

      // ã»ã¬ã¯ãé¡
      const selects = document.querySelectorAll('select');
      if (selects[0] && itemData.condition) setSelect(selects[0], itemData.condition);
      if (selects[1] && itemData.shippingPayer) setSelect(selects[1], itemData.shippingPayer);
      if (selects[2] && itemData.shippingDays) setSelect(selects[2], itemData.shippingDays);
      if (selects[3] && itemData.shippingOrigin) setSelect(selects[3], itemData.shippingOrigin);
      if (selects[4] && itemData.purchaseRequest) setSelect(selects[4], itemData.purchaseRequest);
      await sleep(300);

      // ç»åã¢ããã­ã¼ã
      if (itemData.images && itemData.images.length > 0) {
        const fileInputs = document.querySelectorAll('input[type="file"]');
        const uploadCount = Math.min(itemData.images.length, Math.max(0, fileInputs.length - 2));
        if (uploadCount > 0) {
          log('ç»åã¢ããã­ã¼ãä¸­: ' + uploadCount + 'æ');
          let uploaded = 0;
          for (let i = 0; i < uploadCount; i++) {
            try {
              await uploadImageFromUrl(fileInputs[i], itemData.images[i]);
              uploaded++;
              await sleep(600);
            } catch (e) {
              log('â  ç»å' + (i + 1) + 'æç®ã¹ã­ãã: ' + e.message);
            }
          }
          log('ç»å: ' + uploaded + '/' + uploadCount + 'æå®äº');
        }
      }

      // ã«ãã´ãªé¸æ
      if (itemData.categoryPath) await selectCategory(itemData.categoryPath);
      await sleep(500);

      // ééæ¹æ³é¸æ
      if (itemData.shippingMethod) await selectShippingMethod(itemData.shippingMethod);
      await sleep(500);

      // ãã©ã³ãé¸æ
      if (itemData.brandName && itemData.brandName !== 'ãã©ã³ããªã' && itemData.brandName !== 'ãã©ã³ã') {
        await selectBrand(itemData.brandName);
      }
      await sleep(500);

      log('ç¢ºèªãã¿ã³ãæ¼ãã¾ã...');
      const confirmBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'ç¢ºèªãã');
      if (!confirmBtn) { log('â  ç¢ºèªãã¿ã³ãè¦ã¤ããã¾ãã'); return false; }
      confirmBtn.scrollIntoView();
      await sleep(300);
      confirmBtn.click();

      // ãåºåããããã¿ã³ãå¾ã¤ï¼æå¤§15ç§ï¼
      log('ç¢ºèªãã¼ã¸é·ç§»å¾ã¡...');
      const submitBtn = await new Promise(resolve => {
        let n = 0;
        const t = setInterval(() => {
          n++;
          const btn = [...document.querySelectorAll('button')].find(b =>
            b.textContent.trim() === 'åºåãã' ||
            b.textContent.trim() === 'æ°è¦åºåãã' ||
            b.textContent.trim() === 'åºåãæ°è¦ç»é²ãã'
          );
          if (btn) { clearInterval(t); resolve(btn); }
          if (n > 30) { clearInterval(t); resolve(null); }
        }, 500);
      });

      if (submitBtn) {
        submitBtn.scrollIntoView();
        await sleep(300);
        submitBtn.click();
        log('â åºåå®äºï¼');
        await sleep(3000);
        return true;
      } else {
        log('â  åºåãã¿ã³ãè¦ã¤ããã¾ãã');
        return false;
      }
    } catch (e) {
      log('â ãã©ã¼ã å¥åã¨ã©ã¼: ' + e.message);
      return false;
    }
  }

  // ============================================================
  // ã¢ã¼ãã«é¸æãã«ãã¼
  // ============================================================

  async function selectCategory(categoryPath) {
    log('ã«ãã´ãªé¸æ: ' + categoryPath);
    const labels = categoryPath.split(/> |>/).map(s => s.trim()).filter(Boolean);
    if (!labels.length) return;
    const catBtn = [...document.querySelectorAll('button')].find(b =>
      b.textContent.includes('>') || b.closest('[class*="category"]')
    );
    if (!catBtn) return;
    catBtn.click();
    await sleep(800);
    try {
      const modal = await waitFor('.chakra-dialog__content', 5000);
      for (const label of labels) {
        await sleep(400);
        const btn = [...modal.querySelectorAll('button')].find(b => {
          const text = [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
          return text === label || b.textContent.trim() === label;
        });
        if (btn) btn.click();
      }
    } catch (e) { log('ã«ãã´ãªã¢ã¼ãã«ã¨ã©ã¼: ' + e.message); }
  }

  async function selectShippingMethod(methodName) {
    log('ééæ¹æ³é¸æ: ' + methodName);
    const shipBtn = [...document.querySelectorAll('button')].find(b =>
      b.closest('[class*="shipping-method"], [class*="shippingMethod"]') ||
      b.textContent.includes('ééæ¹æ³ãé¸æ')
    );
    if (!shipBtn) return;
    shipBtn.click();
    await sleep(800);
    try {
      const modal = await waitFor('.chakra-dialog__content', 5000);
      const target = [...modal.querySelectorAll('button, span, label')].find(el => {
        const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
        return text === methodName || el.textContent.trim() === methodName;
      });
      if (target) {
        target.click();
        const parent = target.closest('button') || target.parentElement;
        if (parent && parent !== target) parent.click();
      }
    } catch (e) { log('ééæ¹æ³ã¢ã¼ãã«ã¨ã©ã¼: ' + e.message); }
  }

  async function selectBrand(brandName) {
    log('ãã©ã³ãé¸æ: ' + brandName);
    const brandBtn = [...document.querySelectorAll('button')].find(b => b.closest('[class*="brand"]'));
    if (!brandBtn) return;
    brandBtn.click();
    await sleep(800);
    try {
      const modal = await waitFor('.chakra-dialog__content', 5000);
      const searchInput = modal.querySelector('input[type="text"], input[type="search"]');
      if (searchInput) {
        setInput(searchInput, brandName);
        await sleep(800);
        const result = [...modal.querySelectorAll('button, li')].find(el => el.textContent.trim() === brandName);
        if (result) result.click();
      }
    } catch (e) { log('ãã©ã³ãã¢ã¼ãã«ã¨ã©ã¼: ' + e.message); }
  }

  // ============================================================
  // åé¤å¦ç
  // ============================================================

  async function deleteItem(id) {
    log('åºååé¤ä¸­: ' + id.substring(0, 8) + '...');
    const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (!csrf) { log('CSRFãã¼ã¯ã³åå¾å¤±æ'); return false; }
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/item/' + id;
    form.style.display = 'none';
    const m = document.createElement('input'); m.type = 'hidden'; m.name = '_method'; m.value = 'delete';
    const t = document.createElement('input'); t.type = 'hidden'; t.name = 'authenticity_token'; t.value = csrf;
    form.appendChild(m); form.appendChild(t);
    document.body.appendChild(form);
    form.submit();
    return true;
  }

  // ============================================================
  // ã¡ã¤ã³ã¸ã§ããã­ã¼ï¼ãã¼ã¸ãã¾ããã§ç¶æç®¡çï¼
  // ============================================================

  async function runJob() {
    const job = getJob();
    if (!job) return false;
    const path = location.pathname;

    // --- /item/{id}/edit: ç·¨éãã¼ã¸ã§ãã¼ã¿æ½åº ---
    const editMatch = path.match(/^\/item\/([^/]+)\/edit$/);
    if (editMatch) {
      const id = editMatch[1];
      const jobItem = job.items.find(i => i.id === id);
      if (!jobItem) return false;

      injectStyles();
      showProgressPanel(job);
      log('ãã¼ã¿åå¾ä¸­: ' + id.substring(0, 8) + '...');

      // Reactã®ã¬ã³ããªã³ã°ãå¾ã¤
      try {
        await waitFor('[placeholder="40æå­ã¾ã§"], [maxlength="40"]', 15000);
      } catch (e) { log('â  ãã©ã¼ã èª­ã¿è¾¼ã¿ã¿ã¤ã ã¢ã¦ã'); }
      await sleep(500);

      const data = extractCurrentItemData(id);
      if (data.title) {
        log('â åå¾: ' + data.title.substring(0, 20));
        jobItem.data = data;
        saveJob(job);
      } else {
        log('â  ãã¼ã¿åå¾å¤±æï¼ã¿ã¤ãã«ãªãï¼ãã¹ã­ãããã¾ã');
        jobItem.data = null;
        jobItem.relisted = false;
        saveJob(job);
      }

      // æ¬¡ã®ã¢ã¯ã·ã§ã³
      const nextEdit = job.items.find(i => i.data === null && i.id !== id);
      if (nextEdit) {
        location.href = '/item/' + nextEdit.id + '/edit';
      } else {
        const firstPending = job.items.find(i => i.data && !i.relisted);
        if (firstPending) {
          location.href = '/item/new';
        } else {
          clearJob();
          log('åºåããååãããã¾ãã');
        }
      }
      return true;
    }

    // --- /item/new: æ°è¦åºåãã©ã¼ã å¥å ---
    if (path === '/item/new') {
      const currentItem = job.items.find(i => i.data && !i.relisted);
      if (!currentItem) { clearJob(); return false; }

      injectStyles();
      showProgressPanel(job);
      log('åºåä¸­: ' + currentItem.data.title.substring(0, 20));

      const success = await fillNewItemForm(currentItem.data);
      currentItem.relisted = success;
      saveJob(job);

      if (success && job.deleteOriginals) {
        // åé¤ã¯ãã¼ã¸é·ç§»ããã®ã§ããã§çµããï¼/sellã«æ»ã£ã¦ããåé¤ãã§ã¼ãºï¼
        job.phase = 'delete';
        saveJob(job);
        // æ¬¡ã®æªåºåãããã°åã«åºåãã
        const next = job.items.find(i => i.data && !i.relisted);
        if (next) {
          location.href = '/item/new';
        } else {
          location.href = '/sell';
        }
        return true;
      }

      advanceJob(job);
      return true;
    }

    // --- /sell: åé¤ãã§ã¼ãº ---
    if ((path === '/sell' || path === '/sell/') && job.phase === 'delete') {
      injectStyles();
      showProgressPanel(job);
      const toDelete = job.items.find(i => i.relisted && !i.deleted);
      if (toDelete) {
        await deleteItem(toDelete.id);
        toDelete.deleted = true;
        saveJob(job);
        return true;
      }
      clearJob();
      log('â ãã¹ã¦å®äºãã¾ããï¼');
      showCompleteMessage();
      return true;
    }

    return false;
  }

  function advanceJob(job) {
    const next = job.items.find(i => i.data && !i.relisted);
    if (next) {
      saveJob(job);
      location.href = '/item/new';
    } else {
      clearJob();
      log('â å¨ååºåãå®äºãã¾ããï¼');
      showCompleteMessage();
    }
  }

  // ============================================================
  // UI
  // ============================================================

  function injectStyles() {
    if (document.getElementById('rr-styles')) return;
    const s = document.createElement('style');
    s.id = 'rr-styles';
    s.textContent = `
      #rr-panel{position:fixed;top:20px;right:20px;width:320px;background:#fff;border-radius:12px;box-shadow:0 2px 24px rgba(0,0,0,.2);z-index:99999;font-family:sans-serif;overflow:hidden}
      #rr-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#BF0090;color:#fff;font-weight:bold}
      #rr-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}
      #rr-body{padding:16px;max-height:500px;overflow-y:auto}
      #rr-item-list{list-style:none;margin:0;padding:0}
      #rr-item-list li{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eee}
      #rr-item-list img{width:40px;height:40px;object-fit:cover;border-radius:4px}
      #rr-options{margin-top:12px;padding-top:12px;border-top:1px solid #eee}
      #rr-start-btn{width:100%;margin-top:12px;padding:10px;background:#BF0090;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold}
      #rr-start-btn:disabled{background:#ccc;cursor:not-allowed}
      #rr-log{max-height:150px;overflow-y:auto;font-size:11px;color:#666;margin-top:8px}
      #rr-log p{margin:2px 0}
      .rr-select-all{cursor:pointer;color:#BF0090;text-decoration:underline}
      #rr-progress-bar{background:#eee;border-radius:4px;height:8px;margin-top:4px}
      #rr-progress-fill{background:#BF0090;height:100%;border-radius:4px;transition:width .3s}
    `;
    document.head.appendChild(s);
  }

  function log(msg) {
    const el = document.getElementById('rr-log');
    if (!el) { console.log('[RR] ' + msg); return; }
    const p = document.createElement('p');
    p.textContent = msg;
    el.appendChild(p);
    el.scrollTop = el.scrollHeight;
  }

  function showProgressPanel(job) {
    let panel = document.getElementById('rr-panel');
    if (!panel) {
      injectStyles();
      panel = document.createElement('div');
      panel.id = 'rr-panel';
      panel.innerHTML = '<div id="rr-header"><span>ð ã©ã¯ãååºåãã¼ã«</span><button id="rr-close">â</button></div><div id="rr-body"><div id="rr-progress"><div id="rr-progress-text">å¦çä¸­...</div><div id="rr-progress-bar"><div id="rr-progress-fill" style="width:0%"></div></div></div><div id="rr-log"></div></div>';
      document.body.appendChild(panel);
      document.getElementById('rr-close').onclick = () => panel.remove();
    }
    const done = job.items.filter(i => i.relisted).length;
    const total = job.items.length;
    const fill = document.getElementById('rr-progress-fill');
    const text = document.getElementById('rr-progress-text');
    if (fill) fill.style.width = Math.round(done / total * 100) + '%';
    if (text) text.textContent = done + ' / ' + total + ' ä»¶å®äº';
  }

  function showCompleteMessage() {
    let panel = document.getElementById('rr-panel');
    if (!panel) { injectStyles(); panel = document.createElement('div'); panel.id = 'rr-panel'; document.body.appendChild(panel); }
    panel.innerHTML = '<div id="rr-header"><span>ð ã©ã¯ãååºåãã¼ã«</span><button id="rr-close">â</button></div><div id="rr-body" style="text-align:center;padding:24px 16px"><div style="font-size:48px">â</div><div style="font-size:16px;font-weight:bold;margin-top:8px">ååºåãå®äºãã¾ããï¼</div><button onclick="document.getElementById(\'rr-panel\').remove()" style="margin-top:16px;padding:8px 24px;background:#BF0090;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">éãã</button></div>';
    document.getElementById('rr-close').onclick = () => panel.remove();
  }

  async function showMainUI() {
    injectStyles();
    document.getElementById('rr-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'rr-panel';
    panel.innerHTML = `
      <div id="rr-header">
        <span>ð ã©ã¯ãååºåãã¼ã«</span>
        <button id="rr-close">â</button>
      </div>
      <div id="rr-body">
        <div style="color:#666;font-size:12px;margin-bottom:8px">
          ååºåããååãé¸ãã§ãã ãã
          <span class="rr-select-all" id="rr-select-all">ï¼ãã¹ã¦é¸æï¼</span>
        </div>
        <div style="text-align:center;padding:16px;color:#999" id="rr-loading">èª­ã¿è¾¼ã¿ä¸­...</div>
        <ul id="rr-item-list"></ul>
        <div id="rr-options">
          <label><input type="checkbox" id="rr-delete-orig"> åã®åºåãåé¤ãã</label>
        </div>
        <button id="rr-start-btn" disabled>ååãé¸ãã§ãã ãã</button>
        <div id="rr-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById('rr-close').onclick = () => panel.remove();

    log('åºåä¸­ã®ååãåå¾ä¸­...');
    let items = [];
    try { items = await fetchSellItems(); }
    catch (e) { log('åå¾ã¨ã©ã¼: ' + e.message); }

    document.getElementById('rr-loading')?.remove();
    const list = document.getElementById('rr-item-list');

    if (items.length === 0) {
      list.innerHTML = '<li style="color:#999;padding:8px">åºåä¸­ã®ååãè¦ã¤ããã¾ãã</li>';
      return;
    }
    log('ååãªã¹ãèª­ã¿è¾¼ã¿å®äº: ' + items.length + 'ä»¶');

    for (const item of items) {
      const li = document.createElement('li');
      li.innerHTML = `<input type="checkbox" id="rr-cb-${item.id}" value="${item.id}">${item.thumb ? `<img src="${item.thumb}" alt="">` : ''}<label for="rr-cb-${item.id}">${item.title}</label>`;
      list.appendChild(li);
    }

    list.addEventListener('change', updateBtn);
    function updateBtn() {
      const n = list.querySelectorAll('input:checked').length;
      const btn = document.getElementById('rr-start-btn');
      btn.textContent = n > 0 ? n + 'ä»¶ãååºåãã' : 'ååãé¸ãã§ãã ãã';
      btn.disabled = n === 0;
    }

    document.getElementById('rr-select-all').onclick = () => {
      list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
      updateBtn();
    };

    document.getElementById('rr-start-btn').onclick = () => {
      const selectedIds = [...list.querySelectorAll('input:checked')].map(cb => cb.value);
      const deleteOriginals = document.getElementById('rr-delete-orig').checked;
      const job = {
        phase: 'relist',
        deleteOriginals,
        items: selectedIds.map(id => ({ id, data: null, relisted: false, deleted: false }))
      };
      saveJob(job);
      log('éå§: ' + selectedIds.length + 'ä»¶ â ç·¨éãã¼ã¸ã¸ç§»åä¸­...');
      location.href = '/item/' + selectedIds[0] + '/edit';
    };
  }

  // ============================================================
  // ã¨ã³ããªã¼ãã¤ã³ã
  // ============================================================

  (async function main() {
    const job = getJob();
    if (job) {
      const handled = await runJob();
      if (handled) return;
      if (confirm('ååºåå¦çãä¸­æ­ããã¦ãã¾ãã\nã­ã£ã³ã»ã«ãã¦æåããããç´ãã¾ããï¼')) {
        clearJob();
      }
    }
    if (location.pathname === '/sell' || location.pathname === '/sell/') {
      await showMainUI();
      return;
    }
    alert('ãã®ãã¼ã«ã¯ https://fril.jp/sell ã§èµ·åãã¦ãã ããã\n\nç¾å¨ã®ãã¼ã¸ã«ç§»åãã¾ãã');
    location.href = '/sell';
  })();

})();
