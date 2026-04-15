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
    const items = [];

    // 方法1: /item/{id}/edit リンクからIDを取得（最も確実）
    // 「編集」ボタンのhrefにIDが含まれている
    const editLinks = [...document.querySelectorAll('a[href*="/item/"][href*="/edit"]')];
    for (const a of editLinks) {
      const m = a.href.match(/\/item\/([a-zA-Z0-9_-]+)\/edit/);
      if (!m) continue;
      const id = m[1];
      if (items.find(i => i.id === id)) continue;

      // 同じ商品カード内の要素を探す（「編集」テキスト自体はタイトルでないので使わない）
      const card = a.closest('li, article, [class*="item"], [class*="deal"], tr, div[class]');
      // 画像の alt や、テキストノードからタイトルを推測
      const imgEl = card?.querySelector('img');
      const altText = imgEl?.alt?.trim();
      // imgのaltが「商品名」に近ければそれを使う
      // それ以外はカード内のテキストノードを収集してタイトルを推定
      let title = '';
      if (altText && altText.length > 4 && !altText.includes('http')) {
        title = altText;
      } else if (card) {
        // カード内の全テキストから「編集」「削除」「再出品」などのUI文字を除いたもの
        const allText = [...card.querySelectorAll('*')]
          .filter(el => el.children.length === 0) // テキストノードを持つ末端要素
          .map(el => el.textContent.trim())
          .filter(t => t.length > 4 && !/^(編集|削除|再出品|コメ削|コメ|購入|出品|取引|下書き|\+|\-|\d+円?)$/.test(t))
          .join(' ')
          .trim()
          .substring(0, 50);
        title = allText;
      }
      if (!title) title = '商品ID:' + id;

      items.push({ id, title, thumb: imgEl?.src || '' });
    }
    if (items.length > 0) return items;

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

    return items;
  }

  // ============================================================
  // API経由で商品データを事前取得（/sell ページ上で実行）
  // ============================================================

  // itemオブジェクトから共通フォーマットに変換
  function normalizeItemData(id, item) {
    const title = item.title || item.name;
    if (!title) return null;
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
  }

  async function fetchItemDataViaAPI(id) {
    // 方法1: JSONのAPIエンドポイントを試す（高速）
    const endpoints = [
      '/api/items/' + id,
      '/api/user_items/' + id,
      '/api/v1/items/' + id,
      '/api/v2/items/' + id,
    ];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include'
        });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) continue;
        const json = await res.json();
        const item = json.item || json.user_item || json.data || json;
        if (!item || typeof item !== 'object') continue;
        const result = normalizeItemData(id, item);
        if (result) return result;
      } catch (e) { /* 次を試す */ }
    }

    // 方法2: ポップアップウィンドウで編集ページを開いてReactのDOMからデータ取得
    return await fetchItemDataViaPopup(id);
  }

  // ポップアップウィンドウで編集ページを読み込み、React描画後にデータ抽出
  // （iframeはX-Frame-Optionsでブロックされるため、popupを使用）
  async function fetchItemDataViaPopup(id, existingPopup) {
    return new Promise((resolve) => {
      const popup = existingPopup || window.open(
        '/item/' + id + '/edit',
        'rr_popup_' + id,
        'width=390,height=844,left=0,top=0,toolbar=no,menubar=no,scrollbars=no,resizable=no'
      );

      if (!popup) {
        resolve(null);
        return;
      }

      let attempts = 0;
      const MAX = 30; // 最大15秒

      const timer = setInterval(() => {
        attempts++;
        if (attempts > MAX) {
          clearInterval(timer);
          // timeout: leave popup open, caller will handle
          resolve(null);
          return;
        }
        try {
          const doc = popup.document;
          if (!doc || doc.readyState !== 'complete') return;

          // タイトル入力欄を探す（Reactがレンダリングして値が入るまで待つ）
          const titleInput =
            doc.querySelector('input[placeholder*="40文字"]') ||
            doc.querySelector('input[placeholder*="40字"]') ||
            doc.querySelector('input[maxlength="40"]') ||
            [...doc.querySelectorAll('input[type="text"]')].find(el =>
              (el.placeholder || '').includes('文字') || el.maxLength === 40
            );

          // 値が入っていなければまだロード中
          if (!titleInput?.value) return;

          clearInterval(timer);

          const selects = doc.querySelectorAll('select');
          const buttons = [...doc.querySelectorAll('button')];
          const categoryBtn = buttons.find(b =>
            b.textContent.includes('>') || b.closest('[class*="category"]')
          );
          const brandBtn = buttons.find(b => b.closest('[class*="brand"]'));
          const shippingMethodBtn = buttons.find(b =>
            b.closest('[class*="shipping-method"], [class*="shippingMethod"]') ||
            b.textContent.includes('宅配') || b.textContent.includes('ラクマパック') ||
            b.textContent.includes('飛脚') || b.textContent.includes('ゆうパック')
          );
          const textarea = doc.querySelector('textarea');
          const priceInput =
            doc.querySelector('[placeholder*="300"]') ||
            doc.querySelector('[placeholder*="金額"]') ||
            doc.querySelector('[placeholder*="円"]');

          const images = [...doc.querySelectorAll('img')]
            .filter(img => img.src && (img.src.includes('fril.jp/img') || img.src.includes('item-image')))
            .map(img => img.src.replace('/m/', '/l/').replace(/\?.*$/, ''))
            .filter((url, i, arr) => url && arr.indexOf(url) === i);

          // popup stays open for reuse in fillNewItemForm

          const data = {
            id,
            title: titleInput.value.substring(0, 50),
            description: textarea?.value || '',
            price: priceInput?.value || '',
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
          resolve(data.title ? data : null);

        } catch (e) {
          if (attempts >= MAX) {
            clearInterval(timer);
            // leave popup open on error, caller handles
            resolve(null);
          }
        }
      }, 500);
    });
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

  // doc: 操作対象のpopupウィンドウ（/item/new に遷移してからフォームを埋める）
  async function fillNewItemForm(itemData, popup) {
    log('フォーム入力開始: ' + itemData.title.substring(0, 20));

    // /item/new に遷移後、Reactがレンダリングするまでタイトル入力欄を待つ（最大20秒）
    const titleInput = await new Promise(resolve => {
      let attempts = 0;
      const check = setInterval(() => {
        attempts++;
        try {
          const doc = popup.document;
          if (!doc || doc.readyState !== 'complete') return;
          const el = doc.querySelector('[placeholder="40文字まで"]') ||
                     doc.querySelector('[placeholder*="商品名"]') ||
                     doc.querySelector('[maxlength="40"]');
          if (el) { clearInterval(check); resolve(el); }
        } catch (e) {}
        if (attempts > 40) { clearInterval(check); resolve(null); }
      }, 500);
    });

    if (!titleInput) { log('❌ 出品フォームが見つかりません'); return false; }

    const doc = popup.document;

    setInput(titleInput, itemData.title);
    await sleep(200);

    const priceInput = doc.querySelector('[placeholder*="300"], [placeholder*="円"]');
    if (priceInput) setInput(priceInput, itemData.price);
    await sleep(200);

    const textarea = doc.querySelector('textarea');
    if (textarea) setTextarea(textarea, itemData.description);
    await sleep(200);

    // セレクト類
    const selects = doc.querySelectorAll('select');
    if (selects[0] && itemData.condition) setSelect(selects[0], itemData.condition);
    if (selects[1] && itemData.shippingPayer) setSelect(selects[1], itemData.shippingPayer);
    if (selects[2] && itemData.shippingDays) setSelect(selects[2], itemData.shippingDays);
    if (selects[3] && itemData.shippingOrigin) setSelect(selects[3], itemData.shippingOrigin);
    if (selects[4] && itemData.purchaseRequest) setSelect(selects[4], itemData.purchaseRequest);
    await sleep(300);

    // 画像アップロード
    if (itemData.images && itemData.images.length > 0) {
      log('画像アップロード中: ' + itemData.images.length + '枚');
      const fileInputs = doc.querySelectorAll('input[type="file"]');
      for (let i = 0; i < Math.min(itemData.images.length, fileInputs.length - 2); i++) {
        await uploadImageFromUrl(fileInputs[i], itemData.images[i]);
        await sleep(600);
      }
      log('画像アップロード完了');
    }

    // カテゴリ選択
    if (itemData.categoryPath) {
      await selectCategory(itemData.categoryPath, doc);
    }
    await sleep(500);

    // 配送方法選択
    if (itemData.shippingMethod) {
      await selectShippingMethod(itemData.shippingMethod, doc);
    }
    await sleep(500);

    // ブランド選択（指定なし以外の場合）
    if (itemData.brandName && itemData.brandName !== '指定なし' && itemData.brandName !== 'ブランド') {
      await selectBrand(itemData.brandName, doc);
    }
    await sleep(500);

    log('フォーム入力完了。確認画面へ...');

    // 「確認する」ボタンをクリック
    const confirmBtn = [...doc.querySelectorAll('button')].find(b => b.textContent.trim() === '確認する');
    if (confirmBtn) {
      confirmBtn.scrollIntoView();
      await sleep(300);
      confirmBtn.click();
    } else {
      log('⚠ 確認ボタンが見つかりません');
      return false;
    }

    // 確認ページに遷移後「出品する」ボタンを待つ（最大15秒）
    log('確認ページ待機中...');
    const submitBtn = await new Promise(resolve => {
      let attempts = 0;
      const check = setInterval(() => {
        attempts++;
        try {
          const newDoc = popup.document;
          const btn = [...newDoc.querySelectorAll('button')].find(b =>
            b.textContent.trim() === '出品する' ||
            b.textContent.trim() === '変更する' ||
            b.textContent.trim() === '更新する'
          );
          if (btn) { clearInterval(check); resolve(btn); }
        } catch (e) {}
        if (attempts > 30) { clearInterval(check); resolve(null); }
      }, 500);
    });

    if (submitBtn) {
      submitBtn.scrollIntoView();
      await sleep(300);
      submitBtn.click();
      log('✅ 出品完了！');
      await sleep(3000);
      return true;
    } else {
      log('⚠ 出品ボタンが見つかりません');
      return false;
    }
  }

  function waitForInDoc(doc, selector, timeout) {
    return new Promise((resolve, reject) => {
      const el = doc.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = doc.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(doc.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout || 5000);
    });
  }

  // カテゴリモーダル選択
  async function selectCategory(categoryPath, doc) {
    log('カテゴリ選択: ' + categoryPath);
    const labels = categoryPath.split(/>　|>/).map(s => s.trim()).filter(Boolean);
    if (labels.length === 0) return;

    const catBtn = [...doc.querySelectorAll('button')].find(b =>
      b.textContent.includes('>') || b.closest('[class*="category"]')
    );
    if (!catBtn) return;
    catBtn.click();
    await sleep(800);

    try {
      const modal = await waitForInDoc(doc, '.chakra-dialog__content', 5000);
      for (const label of labels) {
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
  async function selectShippingMethod(methodName, doc) {
    log('配送方法選択: ' + methodName);
    const shipBtn = [...doc.querySelectorAll('button')].find(b =>
      b.closest('[class*="shipping-method"], [class*="shippingMethod"]') ||
      b.textContent.includes('配送方法を選択')
    );
    if (!shipBtn) return;
    shipBtn.click();
    await sleep(800);

    try {
      const modal = await waitForInDoc(doc, '.chakra-dialog__content', 5000);
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
  async function selectBrand(brandName, doc) {
    log('ブランド選択: ' + brandName);
    const brandBtn = [...doc.querySelectorAll('button')].find(b => b.closest('[class*="brand"]'));
    if (!brandBtn) return;
    brandBtn.click();
    await sleep(800);

    try {
      const modal = await waitForInDoc(doc, '.chakra-dialog__content', 5000);
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

    // --- /item/new : 新規出品フェーズ ---
    if (path === '/item/new') {
      const currentItem = job.items.find(i => i.data && !i.relisted);
      if (!currentItem) return false;

      injectStyles();
      showProgressPanel(job);
      log('出品中: ' + currentItem.data.title.substring(0, 20));

      await fillNewItemForm(currentItem.data, window);

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
    const allRelisted = job.items.every(i => i.relisted);

    if (!allRelisted) {
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

    // まずアイテムリストを即時レンダリング（プリフェッチを待たない）
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

      const btn = document.getElementById('rr-start-btn');
      btn.disabled = true;
      btn.textContent = 'ポップアップを開いています...';

      // ユーザー操作コンテキスト内で全ポップアップを一括オープン
      const popups = {};
      for (const id of selectedIds) {
        popups[id] = window.open(
          '/item/' + id + '/edit',
          'rr_popup_' + id,
          'width=390,height=844,left=0,top=0,toolbar=no,menubar=no,scrollbars=no'
        );
        if (!popups[id]) {
          log('❌ ポップアップがブロックされました。ブラウザのポップアップ許可設定でfril.jpを許可してください。');
          btn.textContent = selectedIds.length + '件を再出品する';
          btn.disabled = false;
          return;
        }
      }

      // ポップアップからデータを順次取得
      const jobItems = [];
      for (let i = 0; i < selectedIds.length; i++) {
        const id = selectedIds[i];
        btn.textContent = 'データ取得中 ' + (i + 1) + '/' + selectedIds.length + '件...';
        log('データ取得中 (' + (i + 1) + '/' + selectedIds.length + '): ' + id.substring(0, 8) + '...');
        const data = await fetchItemDataViaPopup(id, popups[id]);
        jobItems.push({ id, data, relisted: false, deleted: false });
        if (data) {
          log('✓ 取得: ' + data.title.substring(0, 20));
        } else {
          log('⚠ 取得失敗: ' + id.substring(0, 8) + '（スキップします）');
        }
      }

      const validItems = jobItems.filter(i => i.data);
      if (validItems.length === 0) {
        log('❌ データ取得できた商品がありません。再度お試しください。');
        btn.textContent = selectedIds.length + '件を再出品する';
        btn.disabled = false;
        return;
      }

      // データ取得したポップアップを使って /item/new に遷移し、フォームを自動入力・出品
      let successCount = 0;
      for (let idx = 0; idx < validItems.length; idx++) {
        const jobItem = validItems[idx];
        const popup = popups[jobItem.id];
        btn.textContent = '出品中 ' + (idx + 1) + '/' + validItems.length + '件...';
        log('新規出品中 (' + (idx + 1) + '/' + validItems.length + '): ' + jobItem.data.title.substring(0, 20));

        // 同じポップアップを /item/new に遷移させてフォームを埋める
        try { popup.location.href = '/item/new'; } catch (e) {
          log('⚠ ポップアップ遷移失敗: ' + e.message);
          continue;
        }

        const success = await fillNewItemForm(jobItem.data, popup);

        if (success && deleteOriginals) {
          log('元の出品を削除中: ' + jobItem.id.substring(0, 8) + '...');
          await deleteItem(jobItem.id);
        }

        try { popup.close(); } catch (e) {}

        if (success) successCount++;
      }

      clearJob();
      btn.textContent = successCount + '件 完了！';
      log('✅ ' + successCount + '/' + validItems.length + '件の再出品が完了しました！');
      if (successCount > 0) showCompleteMessage();
      btn.disabled = false;
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
