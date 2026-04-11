/*!
 * ラクマ再出品ツール v1.0
 * https://github.com/r750k4-ui/rakuma-relist
 *
 * fril.jp上でブックマークレットから起動して使用します。
 * localStorage を使ってページ遷移をまたいで状態を管理します。
 */
(function () {
  'use strict';

  if (!location.hostname.includes('fril.jp')) {
    alert('このツールはラクマ（fril.jp）のページで実行してください。');
    return;
  }

  const STORAGE_KEY = 'rakuma_relist_job';
  const SCRIPT_VERSION = '1.0';

  // ============================================================
  // ユーティリティ
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function waitFor(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('waitFor timeout: ' + selector)); }, timeout);
    });
  }

  // React管理 input に値をセット
  function setInput(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // React管理 textarea に値をセット
  function setTextarea(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // React管理 select に値をセット
  function setSelect(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 画像URLをfetchしてfile inputにセット
  async function uploadImageFromUrl(fileInput, url) {
    const filename = url.split('/').pop().split('?')[0];
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getJob() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; }
  }

  function saveJob(job) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
  }

  function clearJob() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function log(msg) {
    const el = document.getElementById('rr-log');
    if (el) {
      const line = document.createElement('div');
      line.textContent = new Date().toLocaleTimeString('ja-JP') + ' ' + msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
    console.log('[rakuma-relist]', msg);
  }

  // ============================================================
  // UI
  // ============================================================

  const STYLES = `
    #rr-panel {
      position: fixed; top: 16px; right: 16px; z-index: 999999;
      width: 320px; background: #fff; border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18); font-family: sans-serif;
      font-size: 14px; color: #333; overflow: hidden;
    }
    #rr-panel * { box-sizing: border-box; }
    #rr-header {
      background: #BF0000; color: #fff; padding: 12px 16px;
      display: flex; align-items: center; justify-content: space-between;
      font-weight: bold; font-size: 15px;
    }
    #rr-close {
      background: none; border: none; color: #fff; font-size: 20px;
      cursor: pointer; line-height: 1; padding: 0 4px;
    }
    #rr-body { padding: 12px 16px; max-height: 480px; overflow-y: auto; }
    #rr-item-list { list-style: none; margin: 0; padding: 0; }
    #rr-item-list li {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 0; border-bottom: 1px solid #f0f0f0;
    }
    #rr-item-list li:last-child { border-bottom: none; }
    #rr-item-list label { cursor: pointer; flex: 1; line-height: 1.3; }
    #rr-item-list img { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; }
    #rr-options { margin: 12px 0; padding: 8px; background: #f8f8f8; border-radius: 8px; }
    #rr-options label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    #rr-start-btn {
      width: 100%; padding: 12px; background: #BF0000; color: #fff;
      border: none; border-radius: 8px; font-size: 15px; font-weight: bold;
      cursor: pointer; margin-top: 4px;
    }
    #rr-start-btn:hover { background: #a00000; }
    #rr-start-btn:disabled { background: #ccc; cursor: not-allowed; }
    #rr-progress { margin: 8px 0; }
    #rr-progress-bar {
      height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; margin-top: 4px;
    }
    #rr-progress-fill { height: 100%; background: #BF0000; transition: width 0.3s; }
    #rr-log {
      background: #f8f8f8; border-radius: 6px; padding: 8px;
      font-size: 12px; max-height: 120px; overflow-y: auto;
      margin-top: 8px; font-family: monospace;
    }
    #rr-log div { padding: 1px 0; border-bottom: 1px solid #eee; }
    .rr-select-all { font-size: 12px; color: #BF0000; cursor: pointer; text-decoration: underline; }
  `;

  function injectStyles() {
    if (document.getElementById('rr-styles')) return;
    const style = document.createElement('style');
    style.id = 'rr-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ============================================================
  // 出品中商品リスト取得
  // ============================================================

  async function fetchSellItems() {
    // React SPAのため、fetch()ではなく現在のDOM + Rakuma APIから取得する
    const items = [];

    // 方法1: 現在のDOMから直接取得（/sell ページ上で実行した場合）
    // 「編集」リンク（/item/{id}/edit）を探す
    const editLinks = [...document.querySelectorAll('a[href*="/item/"][href*="/edit"]')];
    if (editLinks.length > 0) {
      for (const a of editLinks) {
        const m = a.href.match(/\/item\/([a-f0-9]+)\/edit/);
        if (!m) continue;
        const id = m[1];
        if (items.find(i => i.id === id)) continue;
        const row = a.closest('li, [class*="item"], [class*="deal"], tr') || a.parentElement?.parentElement || a.parentElement;
        const titleEl = row?.querySelector('[class*="title"], [class*="name"], h3, h4, strong, p') || a;
        const imgEl = row?.querySelector('img');
        items.push({
          id,
          title: titleEl.textContent.trim().replace(/\s+/g, ' ').substring(0, 50),
          thumb: imgEl?.src || ''
        });
      }
      return items;
    }

    // 方法2: Rakuma内部APIから取得
    try {
      for (let page = 1; page <= 10; page++) {
        const res = await fetch('/api/user_items?status=selling&page=' + page, {
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!res.ok) break;
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
      console.log('[rakuma-relist] API取得失敗:', e.message);
    }

    // 方法3: DOMから削除ボタンのURLでIDを取得（方法1,2が失敗した場合）
    if (items.length === 0) {
      // data-item-id属性やdeletリンクからIDを取得
      const deleteLinks = [...document.querySelectorAll('a[href*="/item/"][href*="delete"], button[data-item-id], [data-id]')];
      for (const el of deleteLinks) {
        const id = el.dataset.itemId || el.dataset.id ||
          (el.href || '').match(/\/item\/([a-f0-9]+)/)?.[1];
        if (!id || items.find(i => i.id === id)) continue;
        const row = el.closest('li, [class*="item"], [class*="deal"], tr') || el.parentElement?.parentElement;
        const titleEl = row?.querySelector('[class*="title"], [class*="name"], h3, h4, strong, p');
        const imgEl = row?.querySelector('img');
        items.push({
          id: String(id),
          title: (titleEl?.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 50) || '商品' + id,
          thumb: imgEl?.src || ''
        });
      }
    }

    return items;
  }

  // ============================================================
  // API経由で商品データを事前取得（/sell ページ上で実行）
  // ============================================================

  async function fetchItemDataViaAPI(id) {
    const endpoints = [
      '/api/items/' + id,
      '/api/user_items/' + id,
      '/api/v1/items/' + id,
    ];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!res.ok) continue;
        const json = await res.json();
        const item = json.item || json.user_item || json.data || json;
        if (!item || typeof item !== 'object') continue;
        const title = item.title || item.name;
        if (!title) continue;

        // 画像URL正規化
        const rawPhotos = item.photos || item.images || item.item_images || [];
        const images = rawPhotos.map(p => {
          const url = typeof p === 'string' ? p : (p.url || p.image_url || p.src || '');
          return url.replace('/m/', '/l/').replace(/\?.*$/, '');
        }).filter(Boolean);

        return {
          id,
          title: String(title).substring(0, 50),
          description: String(item.description || item.body || ''),
          price: String(item.price || item.selling_price || ''),
          condition: String(item.condition_id || item.condition || ''),
          shippingPayer: String(item.shipping_payer_id || item.shipping_payer || ''),
          shippingDays: String(item.shipping_days_id || item.shipping_days || ''),
          shippingOrigin: String(item.shipping_origin_id || item.shipping_origin_prefecture_id || ''),
          purchaseRequest: String(item.purchase_request || ''),
          images,
          categoryPath: (item.category && (item.category.path || item.category.name)) || item.category_name || '',
          brandName: (item.brand && item.brand.name) || item.brand_name || '',
          shippingMethod: (item.shipping_method && item.shipping_method.name) || item.shipping_method_name || '',
        };
      } catch (e) {
        // 次のエンドポイントを試す
      }
    }
    return null;
  }

  // ============================================================
  // 商品データ抽出（/item/{id}/edit ページ上で実行）
  // ============================================================

  function extractCurrentItemData(id) {
    const selects = document.querySelectorAll('select');
    const buttons = [...document.querySelectorAll('button')];

    // カテゴリボタン（モーダルを開くボタン）テキストを取得
    // カテゴリは ">" を含む場合が多い
    const categoryBtn = buttons.find(b =>
      b.textContent.includes('>') || b.closest('[class*="category"]')
    );
    // ブランドボタン
    const brandBtn = buttons.find(b => b.closest('[class*="brand"]'));
    // 配送方法ボタン
    const shippingMethodBtn = buttons.find(b =>
      b.closest('[class*="shipping-method"], [class*="shippingMethod"]') ||
      b.textContent.includes('宅配') || b.textContent.includes('ラクマパック') ||
      b.textContent.includes('飛脚') || b.textContent.includes('ゆうパック')
    );

    const images = [...document.querySelectorAll('img[src*="fril.jp/img"]')]
      .map(img => img.src.replace('/m/', '/l/').replace(/\?.*$/, ''))
      .filter((url, i, arr) => arr.indexOf(url) === i); // 重複除去

    return {
      id,
      title: document.querySelector('[placeholder="40文字まで"]')?.value || '',
      description: document.querySelector('textarea')?.value || '',
      price: document.querySelector('[placeholder*="300"], [placeholder*="円"]')?.value || '',
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
  // 新規出品フォーム入力（/item/new ページ上で実行）
  // ============================================================

  async function fillNewItemForm(itemData) {
    log('フォーム入力開始: ' + itemData.title.substring(0, 20));
    await sleep(1000);

    // テキストフィールド
    const titleInput = document.querySelector('[placeholder="40文字まで"]');
    if (titleInput) setInput(titleInput, itemData.title);
    await sleep(200);

    const priceInput = document.querySelector('[placeholder*="300"], [placeholder*="円"]');
    if (priceInput) setInput(priceInput, itemData.price);
    await sleep(200);

    const textarea = document.querySelector('textarea');
    if (textarea) setTextarea(textarea, itemData.description);
    await sleep(200);

    // セレクト類
    const selects = document.querySelectorAll('select');
    if (selects[0] && itemData.condition) setSelect(selects[0], itemData.condition);
    if (selects[1] && itemData.shippingPayer) setSelect(selects[1], itemData.shippingPayer);
    if (selects[2] && itemData.shippingDays) setSelect(selects[2], itemData.shippingDays);
    if (selects[3] && itemData.shippingOrigin) setSelect(selects[3], itemData.shippingOrigin);
    if (selects[4] && itemData.purchaseRequest) setSelect(selects[4], itemData.purchaseRequest);
    await sleep(300);

    // 画像アップロード
    if (itemData.images && itemData.images.length > 0) {
      log('画像アップロード中: ' + itemData.images.length + '枚');
      const fileInputs = document.querySelectorAll('input[type="file"]');
      for (let i = 0; i < Math.min(itemData.images.length, fileInputs.length - 2); i++) {
        await uploadImageFromUrl(fileInputs[i], itemData.images[i]);
        await sleep(600);
      }
      log('画像アップロード完了');
    }

    // カテゴリ選択
    if (itemData.categoryPath) {
      await selectCategory(itemData.categoryPath);
    }
    await sleep(500);

    // 配送方法選択
    if (itemData.shippingMethod) {
      await selectShippingMethod(itemData.shippingMethod);
    }
    await sleep(500);

    // ブランド選択（指定なし以外の場合）
    if (itemData.brandName && itemData.brandName !== '指定なし' && itemData.brandName !== 'ブランド') {
      await selectBrand(itemData.brandName);
    }
    await sleep(500);

    log('フォーム入力完了。確認画面へ...');

    // 「確認する」ボタンをクリック
    const confirmBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '確認する');
    if (confirmBtn) {
      confirmBtn.scrollIntoView();
      await sleep(300);
      confirmBtn.click();
      await sleep(2000);
    }

    // 「出品する」ボタンをクリック
    const submitBtn = [...document.querySelectorAll('button')].find(b =>
      b.textContent.trim() === '出品する' || b.textContent.trim() === '変更する' || b.textContent.trim() === '更新する'
    );
    if (submitBtn) {
      submitBtn.scrollIntoView();
      await sleep(300);
      submitBtn.click();
      log('出品完了！');
      await sleep(3000);
    }
  }

  // カテゴリモーダル選択
  async function selectCategory(categoryPath) {
    log('カテゴリ選択: ' + categoryPath);
    const labels = categoryPath.split(/>　|/).map(s => s.trim()).filter(Boolean);
    if (labels.length === 0) return;

    // カテゴリボタンを要してクリック
    const buttons = [...document.querySelectorAll('button')];
    const catBtn = buttons.find(b =>
      b.textContent.includes('>') || b.closest('[class*="category"]')
    );
    if (!catBtn) return;

    catBtn.click();
    await sleep(800);

    try {
      const modal = await waitFor('.chakra-dialog__content', 5000);
      for (const label of  labels) {
        await sleep(400);
        const btn = [...modal.querySelectorAll('button')].find(b => {
          const text = [...b.childNodes]
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim())
            .join('');
          return text === label || b.textContent.trim() === label;
        });
        if (btn) btn.click();
      }
    } catch (e) {
      log('カテゴリモーダルエラー: ' + e.message);
    }
  }

  // 配送方法モーダル選択
  async function selectShippingMethod(methodName) {
    log('配送方法選択: ' + methodName);
    const buttons = [...document.querySelectorAll('button')];
    const shipBtn = buttons.find(b =>
      b.closest('[class*="shipping-method"], [class*="shippingMethod"]') ||
      b.textContent.includes('配送方法を選択')
    );
    if (!shipBtn) return;

    shipBtn.click();
    await sleep(800);

    try {
      const modal = await waitFor('.chakra-dialog__content', 5000);
      const target = [...modal.querySelectorAll('button, span, label')].find(el => {
        const text = [...el.childNodes]
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join('');
        return text === methodName || el.textContent.trim() === methodName;
      });
      if (target) {
        target.click();
        const parent = target.closest('button') || target.parentElement;
        if (parent && parent !== target) parent.click();
      }
    } catch (e) {
      log('配送方法モーダルエラー: ' + e.message);
    }
  }

  // ブランドモーダル選択
  async function selectBrand(brandName) {
    log('ブランド選択: ' + brandName);
    const buttons = [...document.querySelectorAll('button')];
    const brandBtn = buttons.find(b => b.closest('[class*="brand"]'));
    if (!brandBtn) return;

    brandBtn.click();
    await sleep(800);

    try {
      const modal = await waitFor('.chakra-dialog__content', 5000);
      const searchInput = modal.querySelector('input[type="text"], input[type="search"]');
      if (searchInput) {
        setInput(searchInput, brandName);
        await sleep(800);
        const result = [...modal.querySelectorAll('button, li')].find(el =>
          el.textContent.trim() === brandName
        );
        if (result) result.click();
      }
    } catch (e) {
      log('ブランドモーダルエラー: ' + e.message);
    }
  }

  // ============================================================
  // 削除処理
  // ============================================================

  async function deleteItem(id) {
    log('元の出品を削除中: ' + id.substring(0, 8) + '...');
    const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (!csrf) { log('CSRFトークン取得失敗'); return false; }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/item/' + id;
    form.style.display = 'none';

    const m = document.createElement('input');
    m.type = 'hidden'; m.name = '_method'; m.value = 'delete';
    const t = document.createElement('input');
    t.type = 'hidden'; t.name = 'authenticity_token'; t.value = csrf;

    form.appendChild(m);
    form.appendChild(t);
    document.body.appendChild(form);
    form.submit();
    return true;
  }

  // ============================================================
  // メインフロー制御
  // ============================================================

  async function runJob() {
    const job = getJob();
    if (!job) return false;

    const path = location.pathname;

    // --- /item/{id}/edit : データ抽出フェーズ ---
    const editMatch = path.match(/^\/item\/([a-f0-9]+)\/edit$/);
    if (editMatch) {
      const id = editMatch[1];
      // このIDが処理対象か確認
      const pending = job.items.find(i => i.id === id && !i.data);
      if (!pending) return false;

      injectStyles();
      showProgressPanel(job);
      log('データ取得中: ' + id.substring(0, 8) + '...');

      await sleep(2000); // ページ読み込み待機

      const data = extractCurrentItemData(id);
      pending.data = data;
      saveJob(job);

      log('データ取得完了: ' + data.title.substring(0, 20));
      await sleep(500);

      // 次のアクションへ
      advanceJob(job);
      return true;
    }

    // --- /item/new : 新規出品フェーズ ---
    if (path === '/item/new') {
      const currentItem = job.items.find(i => i.data && !i.relisted);
      if (!currentItem) return false;

      injectStyles();
      showProgressPanel(job);
      log('出品中: ' + currentItem.data.title.substring(0, 20));

      await fillNewItemForm(currentItem.data);

      currentItem.relisted = true;
      saveJob(job);

      advanceJob(job);
      return true;
    }

    // --- /sell : 削除フェーズ ---
    if (path === '/sell' && job.phase === 'delete') {
      injectStyles();
      showProgressPanel(job);

      const toDelete = job.items.find(i => i.relisted && !i.deleted);
      if (toDelete) {
        await deleteItem(toDelete.id);
        toDelete.deleted = true;
        saveJob(job);
        // deleteはページ遷移するので次回実行に委ねる
        return true;
      }

      // 全件完了
      clearJob();
      log('✅ すべての処理が完了しました！');
      showCompleteMessage();
      return true;
    }

    return false;
  }

  function advanceJob(job) {
    const allDataCollected = job.items.every(i => i.data);
    const allRelisted = job.items.every(i => i.relisted);

    if (!allDataCollected) {
      // 次の未取得アイテムの編集ページへ
      const next = job.items.find(i => !i.data);
      saveJob(job);
      location.href = '/item/' + next.id + '/edit';
    } else if (!allRelisted) {
      // 次の未出品アイテムの出品ページへ
      saveJob(job);
      location.href = '/item/new';
    } else if (job.deleteOriginals) {
      // 削除フェーズへ
      job.phase = 'delete';
      saveJob(job);
      location.href = '/sell';
    } else {
      // 全完了
      clearJob();
      log('✅ 再出品が完了しました！');
      showCompleteMessage();
    }
  }

  function showProgressPanel(job) {
    let panel = document.getElementById('rr-panel');
    if (!panel) {
      injectStyles();
      panel = document.createElement('div');
      panel.id = 'rr-panel';
      panel.innerHTML = `
        <div id="rr-header">
          <span>🔄 ラクマ再出品ツール</span>
          <button id="rr-close">✕</button>
        </div>
        <div id="rr-body">
          <div id="rr-progress">
            <div id="rr-progress-text">処理中...</div>
            <div id="rr-progress-bar"><div id="rr-progress-fill" style="width:0%"></div></div>
          </div>
          <div id="rr-log"></div>
        </div>
      `;
      document.body.appendChild(panel);
      document.getElementById('rr-close').onclick = () => panel.remove();
    }

    // 進捗更新
    const done = job.items.filter(i => i.relisted).length;
    const total = job.items.length;
    const pct = Math.round((done / total) * 100);
    const fill = document.getElementById('rr-progress-fill');
    const text = document.getElementById('rr-progress-text');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = done + ' / ' + total + ' 件完了';
  }

  function showCompleteMessage() {
    let panel = document.getElementById('rr-panel');
    if (!panel) { injectStyles(); panel = document.createElement('div'); panel.id = 'rr-panel'; document.body.appendChild(panel); }
    panel.innerHTML = `
      <div id="rr-header"><span>🔄 ラクマ再出品ツール</span><button id="rr-close">✕</button></div>
      <div id="rr-body" style="text-align:center;padding:24px 16px">
        <div style="font-size:48px">✅</div>
        <div style="font-size:16px;font-weight:bold;margin-top:8px">再出品が完了しました！</div>
        <button onclick="document.getElementById('rr-panel').remove()" style="margin-top:16px;padding:8px 24px;background:#BF0000;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">閉じる</button>
      </div>
    `;
    document.getElementById('rr-close').onclick = () => panel.remove();
  }

  // ============================================================
  // /sell ページのメインUI表示
  // ============================================================

  async function showMainUI() {
    injectStyles();

    // 既存パネル削除
    document.getElementById('rr-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'rr-panel';
    panel.innerHTML = `
      <div id="rr-header">
        <span>🔄 ラクマ再出品ツール</span>
        <button id="rr-close">✕</button>
      </div>
      <div id="rr-body">
        <div style="color:#666;font-size:12px;margin-bottom:8px">
          再出品する商品を選択してください
          <span class="rr-select-all" id="rr-select-all">（すべて選択）</span>
        </div>
        <div style="text-align:center;padding:16px;color:#999" id="rr-loading">読み込み中...</div>
        <ul id="rr-item-list"></ul>
        <div id="rr-options">
          <label>
            <input type="checkbox" id="rr-delete-orig">
            元の出品を削除する
          </label>
        </div>
        <button id="rr-start-btn" disabled>商品を選択してください</button>
        <div id="rr-log"></div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('rr-close').onclick = () => panel.remove();

    // 商品リスト取得
    log('出品中の商品を取得中...');
    let items = [];
    try {
      items = await fetchSellItems();
    } catch (e) {
      log('取得エラー: ' + e.message);
    }

    document.getElementById('rr-loading')?.remove();
    const list = document.getElementById('rr-item-list');

    if (items.length === 0) {
      list.innerHTML = '<li style="color:#999;padding:8px">出品中の商品が見つかりません</li>';
      return;
    }

    // API経由で商品詳細を事前取得（編集ページ訪問を省略するため）
    log('商品詳細データを取得中...');
    let prefetchCount = 0;
    for (const item of items) {
      const data = await fetchItemDataViaAPI(item.id);
      if (data) {
        item._prefetchedData = data;
        prefetchCount++;
      }
    }
    if (prefetchCount === items.length) {
      log('✓ 全商品の詳細取得完了（ワンクリック再出品が可能です）');
    } else if (prefetchCount > 0) {
      log(prefetchCount + '/' + items.length + '件取得済み（残りは編集ページで取得）');
    } else {
      log('API取得不可。各編集ページでブックマークレットを再クリックしてください');
    }

    for (const item of items) {
      const li = document.createElement('li');
      li.innerHTML = `
        <input type="checkbox" id="rr-cb-${item.id}" value="${item.id}">
        ${item.thumb ? `<img src="${item.thumb}" alt="">` : ''}
        <label for="rr-cb-${item.id}">${item.title}</label>
      `;
      list.appendChild(li);
    }

    // チェックボックス変化で開始ボタン更新
    list.addEventListener('change', updateStartBtn);

    function updateStartBtn() {
      const checked = list.querySelectorAll('input[type="checkbox"]:checked');
      const btn = document.getElementById('rr-start-btn');
      if (checked.length > 0) {
        btn.textContent = checked.length + '件を再出品する';
        btn.disabled = false;
      } else {
        btn.textContent = '商品を選択してください';
        btn.disabled = true;
      }
    }

    // すべて選択
    document.getElementById('rr-select-all').onclick = () => {
      list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
      updateStartBtn();
    };

    // 再出品開始
    document.getElementById('rr-start-btn').onclick = async () => {
      const checked = [...list.querySelectorAll('input[type="checkbox"]:checked')];
      const selectedIds = checked.map(cb => cb.value);
      const deleteOriginals = document.getElementById('rr-delete-orig').checked;

      document.getElementById('rr-start-btn').disabled = true;
      document.getElementById('rr-start-btn').textContent = '処理中...';

      // 事前取得済みのデータを使用
      const jobItems = selectedIds.map(id => {
        const item = items.find(i => i.id === id);
        return {
          id,
          data: item?._prefetchedData || null,
          relisted: false,
          deleted: false
        };
      });

      const allDataReady = jobItems.every(i => i.data);
      const job = {
        version: SCRIPT_VERSION,
        phase: allDataReady ? 'relist' : 'extract',
        deleteOriginals,
        items: jobItems
      };
      saveJob(job);

      log('ジョブ開始: ' + selectedIds.length + '件' + (allDataReady ? '（データ取得済み）' : ''));
      await sleep(500);

      if (allDataReady) {
        // 編集ページ不要 → 直接新規出品へ
        location.href = '/item/new';
      } else {
        // データ未取得の最初のアイテムの編集ページへ
        const firstNoData = jobItems.find(i => !i.data);
        log('⚠ 編集ページに移動します。ページ読み込み後に再度ブックマークレットをクリックしてください');
        await sleep(1500);
        location.href = '/item/' + firstNoData.id + '/edit';
      }
    };

    log('商品リスト読み込み完了: ' + items.length + '件');
  }

  // ============================================================
  // エントリーポイント
  // ============================================================

  (async function main() {
    // 進行中のジョブがあれば継続
    const job = getJob();
    if (job) {
      const handled = await runJob();
      if (handled) return;
      // 対象外ページならジョブをキャンセルするか確認
      if (confirm('再出品処理が中断されています。\nキャンセルして最初からやり直しますか？')) {
        clearJob();
      }
    }

    // /sell ページならメインUIを表示
    if (location.pathname === '/sell' || location.pathname === '/sell/') {
      await showMainUI();
      return;
    }

    // その他のページ
    alert('ラクマの「出品した商品」ページ（https://fril.jp/sell）で起動してください。\n\n現在ページに移動します。');
    location.href = '/sell';
  })();

})();
