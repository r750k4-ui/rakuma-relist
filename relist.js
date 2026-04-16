/*!
 * ラクマ再出品ツール v2.0
 * https://github.com/r750k4-ui/rakuma-relist
 *
 * fril.jp上でブックマークレットから起動して使用します。
 * localStorageを使ってページをまたいで状態を管理します。
 */
(function () {
  'use strict';

  if (!location.hostname.includes('fril.jp')) {
    alert('このツールはfril.jp（ラクマ）のページで起動してください。');
    return;
  }

  const STORAGE_KEY = 'rakuma_relist_job';

  // ============================================================
  // ユーティリティ
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

  // React管理フォームへの値設定（同一ウィンドウなので問題なし）
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

  // 画像URLをfile inputにアップロード
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
  // ジョブ管理（localStorage）
  // ============================================================

  function getJob() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
    catch (e) { return null; }
  }
  function saveJob(job) { localStorage.setItem(STORAGE_KEY, JSON.stringify(job)); }
  function clearJob() { localStorage.removeItem(STORAGE_KEY); }

  // ============================================================
  // /sell ページ：出品中商品リスト取得
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
      console.log('[rakuma-relist] API取得エラー:', e.message);
    }
    return items;
  }

  // ============================================================
  // /item/{id}/edit ページ：現在ページからデータ抽出
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
      b.textContent.includes('配送') || b.textContent.includes('ヤマト') ||
      b.textContent.includes('宅急便') || b.textContent.includes('ゆうゆう')
    );

    const images = [...document.querySelectorAll('img[src*="fril.jp/img"]')]
      .map(img => img.src.replace('/m/', '/l/').replace(/\?.*$/, ''))
      .filter((url, i, arr) => url && arr.indexOf(url) === i);

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
  // /item/new ページ：フォーム自動入力（同一ウィンドウで実行）
  // ============================================================

  async function fillNewItemForm(itemData) {
    log('フォーム入力開始: ' + itemData.title.substring(0, 20));

    // タイトル入力欄が現れるまで待つ（最大20秒）
    let titleInput;
    try {
      titleInput = await waitFor('[placeholder="40文字まで"], [placeholder*="商品名"], [maxlength="40"]', 20000);
    } catch (e) {
      log('❌ タイトル入力欄が見つかりません');
      return false;
    }

    try {
      log('タイトル入力中...');
      setInput(titleInput, itemData.title);
      await sleep(400);

      const priceInput = document.querySelector('[placeholder*="300"], [placeholder*="円"], [placeholder*="金額"]');
      if (priceInput && itemData.price) setInput(priceInput, itemData.price);
      await sleep(200);

      const textarea = document.querySelector('textarea');
      if (textarea && itemData.description) setTextarea(textarea, itemData.description);
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
        const fileInputs = document.querySelectorAll('input[type="file"]');
        const uploadCount = Math.min(itemData.images.length, Math.max(0, fileInputs.length - 2));
        if (uploadCount > 0) {
          log('画像アップロード中: ' + uploadCount + '枚');
          let uploaded = 0;
          for (let i = 0; i < uploadCount; i++) {
            try {
              await uploadImageFromUrl(fileInputs[i], itemData.images[i]);
              uploaded++;
              await sleep(600);
            } catch (e) {
              log('⚠ 画像' + (i + 1) + '枚目スキップ: ' + e.message);
            }
          }
          log('画像: ' + uploaded + '/' + uploadCount + '枚完了');
        }
      }

      // カテゴリ選択
      if (itemData.categoryPath) await selectCategory(itemData.categoryPath);
      await sleep(500);

      // 配送方法選択
      if (itemData.shippingMethod) await selectShippingMethod(itemData.shippingMethod);
      await sleep(500);

      // ブランド選択
      if (itemData.brandName && itemData.brandName !== 'ブランドなし' && itemData.brandName !== 'ブランド') {
        await selectBrand(itemData.brandName);
      }
      await sleep(500);

      log('確認ボタンを押します...');
      const confirmBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '確認する');
      if (!confirmBtn) { log('⚠ 確認ボタンが見つかりません'); return false; }
      confirmBtn.scrollIntoView();
      await sleep(300);
      confirmBtn.click();

      // 「出品する」ボタンを待つ（最大15秒）
      log('確認ページ遷移待ち...');
      const submitBtn = await new Promise(resolve => {
        let n = 0;
        const t = setInterval(() => {
          n++;
          const btn = [...document.querySelectorAll('button')].find(b =>
            b.textContent.trim() === '出品する' ||
            b.textContent.trim() === '新規出品する' ||
            b.textContent.trim() === '出品を新規登録する'
          );
          if (btn) { clearInterval(t); resolve(btn); }
          if (n > 30) { clearInterval(t); resolve(null); }
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
    } catch (e) {
      log('❌ フォーム入力エラー: ' + e.message);
      return false;
    }
  }

  // ============================================================
  // モーダル選択ヘルパー
  // ============================================================

  async function selectCategory(categoryPath) {
    log('カテゴリ選択: ' + categoryPath);
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
    } catch (e) { log('カテゴリモーダルエラー: ' + e.message); }
  }

  async function selectShippingMethod(methodName) {
    log('配送方法選択: ' + methodName);
    const shipBtn = [...document.querySelectorAll('button')].find(b =>
      b.closest('[class*="shipping-method"], [class*="shippingMethod"]') ||
      b.textContent.includes('配送方法を選択')
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
    } catch (e) { log('配送方法モーダルエラー: ' + e.message); }
  }

  async function selectBrand(brandName) {
    log('ブランド選択: ' + brandName);
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
    } catch (e) { log('ブランドモーダルエラー: ' + e.message); }
  }

  // ============================================================
  // 削除処理
  // ============================================================

  async function deleteItem(id) {
    log('出品削除中: ' + id.substring(0, 8) + '...');
    const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (!csrf) { log('CSRFトークン取得失敗'); return false; }
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
  // メインジョブフロー（ページをまたいで状態管理）
  // ============================================================

  async function runJob() {
    const job = getJob();
    if (!job) return false;
    const path = location.pathname;

    // --- /item/{id}/edit: 編集ページでデータ抽出 ---
    const editMatch = path.match(/^\/item\/([^/]+)\/edit$/);
    if (editMatch) {
      const id = editMatch[1];
      const jobItem = job.items.find(i => i.id === id);
      if (!jobItem) return false;

      injectStyles();
      showProgressPanel(job);
      log('データ取得中: ' + id.substring(0, 8) + '...');

      // Reactのレンダリングを待つ
      try {
        await waitFor('[placeholder="40文字まで"], [maxlength="40"]', 15000);
      } catch (e) { log('⚠ フォーム読み込みタイムアウト'); }
      await sleep(500);

      const data = extractCurrentItemData(id);
      if (data.title) {
        log('✓ 取得: ' + data.title.substring(0, 20));
        jobItem.data = data;
        saveJob(job);
      } else {
        log('⚠ データ取得失敗（タイトルなし）、スキップします');
        jobItem.data = null;
        jobItem.relisted = false;
        saveJob(job);
      }

      // 次のアクション
      const nextEdit = job.items.find(i => i.data === null && i.id !== id);
      if (nextEdit) {
        location.href = '/item/' + nextEdit.id + '/edit';
      } else {
        const firstPending = job.items.find(i => i.data && !i.relisted);
        if (firstPending) {
          location.href = '/item/new';
        } else {
          clearJob();
          log('出品する商品がありません');
        }
      }
      return true;
    }

    // --- /item/new: 新規出品フォーム入力 ---
    if (path === '/item/new') {
      const currentItem = job.items.find(i => i.data && !i.relisted);
      if (!currentItem) { clearJob(); return false; }

      injectStyles();
      showProgressPanel(job);
      log('出品中: ' + currentItem.data.title.substring(0, 20));

      const success = await fillNewItemForm(currentItem.data);
      currentItem.relisted = success;
      saveJob(job);

      if (success && job.deleteOriginals) {
        // 削除はページ遷移するのでここで終わり（/sellに戻ってから削除フェーズ）
        job.phase = 'delete';
        saveJob(job);
        // 次の未出品があれば先に出品する
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

    // --- /sell: 削除フェーズ ---
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
      log('✅ すべて完了しました！');
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
      log('✅ 全再出品が完了しました！');
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
      panel.innerHTML = '<div id="rr-header"><span>🔄 ラクマ再出品ツール</span><button id="rr-close">✕</button></div><div id="rr-body"><div id="rr-progress"><div id="rr-progress-text">処理中...</div><div id="rr-progress-bar"><div id="rr-progress-fill" style="width:0%"></div></div></div><div id="rr-log"></div></div>';
      document.body.appendChild(panel);
      document.getElementById('rr-close').onclick = () => panel.remove();
    }
    const done = job.items.filter(i => i.relisted).length;
    const total = job.items.length;
    const fill = document.getElementById('rr-progress-fill');
    const text = document.getElementById('rr-progress-text');
    if (fill) fill.style.width = Math.round(done / total * 100) + '%';
    if (text) text.textContent = done + ' / ' + total + ' 件完了';
  }

  function showCompleteMessage() {
    let panel = document.getElementById('rr-panel');
    if (!panel) { injectStyles(); panel = document.createElement('div'); panel.id = 'rr-panel'; document.body.appendChild(panel); }
    panel.innerHTML = '<div id="rr-header"><span>🔄 ラクマ再出品ツール</span><button id="rr-close">✕</button></div><div id="rr-body" style="text-align:center;padding:24px 16px"><div style="font-size:48px">✅</div><div style="font-size:16px;font-weight:bold;margin-top:8px">再出品が完了しました！</div><button onclick="document.getElementById(\'rr-panel\').remove()" style="margin-top:16px;padding:8px 24px;background:#BF0090;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">閉じる</button></div>';
    document.getElementById('rr-close').onclick = () => panel.remove();
  }

  async function showMainUI() {
    injectStyles();
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
          再出品する商品を選んでください
          <span class="rr-select-all" id="rr-select-all">（すべて選択）</span>
        </div>
        <div style="text-align:center;padding:16px;color:#999" id="rr-loading">読み込み中...</div>
        <ul id="rr-item-list"></ul>
        <div id="rr-options">
          <label><input type="checkbox" id="rr-delete-orig"> 元の出品を削除する</label>
        </div>
        <button id="rr-start-btn" disabled>商品を選んでください</button>
        <div id="rr-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById('rr-close').onclick = () => panel.remove();

    log('出品中の商品を取得中...');
    let items = [];
    try { items = await fetchSellItems(); }
    catch (e) { log('取得エラー: ' + e.message); }

    document.getElementById('rr-loading')?.remove();
    const list = document.getElementById('rr-item-list');

    if (items.length === 0) {
      list.innerHTML = '<li style="color:#999;padding:8px">出品中の商品が見つかりません</li>';
      return;
    }
    log('商品リスト読み込み完了: ' + items.length + '件');

    for (const item of items) {
      const li = document.createElement('li');
      li.innerHTML = `<input type="checkbox" id="rr-cb-${item.id}" value="${item.id}">${item.thumb ? `<img src="${item.thumb}" alt="">` : ''}<label for="rr-cb-${item.id}">${item.title}</label>`;
      list.appendChild(li);
    }

    list.addEventListener('change', updateBtn);
    function updateBtn() {
      const n = list.querySelectorAll('input:checked').length;
      const btn = document.getElementById('rr-start-btn');
      btn.textContent = n > 0 ? n + '件を再出品する' : '商品を選んでください';
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
      log('開始: ' + selectedIds.length + '件 → 編集ページへ移動中...');
      location.href = '/item/' + selectedIds[0] + '/edit';
    };
  }

  // ============================================================
  // エントリーポイント
  // ============================================================

  (async function main() {
    const job = getJob();
    if (job) {
      const handled = await runJob();
      if (handled) return;
      if (confirm('再出品処理が中断されています。\nキャンセルして最初からやり直しますか？')) {
        clearJob();
      }
    }
    if (location.pathname === '/sell' || location.pathname === '/sell/') {
      await showMainUI();
      return;
    }
    alert('このツールは https://fril.jp/sell で起動してください。\n\n現在のページに移動します。');
    location.href = '/sell';
  })();

})();
