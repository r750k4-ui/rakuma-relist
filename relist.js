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

    // まずAPIで試みる（複数エンドポイント）
    const apiEndpoints = [
      '/api/sell_items?page=1&per_page=100',
      '/api/items?status=on_sale&page=1&per_page=100',
      '/api/users/current/items?status=on_sale&page=1&per_page=100',
    ];
    for (const endpoint of apiEndpoints) {
      try {
        const res = await fetch(endpoint, {
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include'
        });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) continue;
        const json = await res.json();
        const list = json.items || json.user_items || json.data || [];
        if (list.length === 0) continue;
        for (const item of list) {
          const id = item.id || item.item_id;
          if (!id) continue;
          items.push({
            id: String(id),
            title: (item.title || item.name || '').substring(0, 50),
            thumb: item.thumbnail_url || item.image_url || ''
          });
        }
        if (items.length > 0) return items;
      } catch (e) {
        console.log('[rakuma-relist] API取得エラー:', endpoint, e.message);
      }
    }

    // APIが全て失敗した場合、DOMから直接スクレイプ
    // （/sell ページの商品リンクからIDを取得）
    log('APIが使えないためDOMから商品を取得します...');
    const scraped = scrapeItemsFromDOM();
    if (scraped.length > 0) return scraped;

    // DOMにも商品がない場合、/sell ページを fetch してHTMLから抽出
    try {
      log('/sell ページをfetchして商品を䊽出中...');
      const res = await fetch('/sell', { credentials: 'include' });
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const extracted = scrapeItemsFromDoc(doc);
      if (extracted.length > 0) return extracted;
    } catch (e) {
      console.log('[rakuma-relist] /sell fetch エラー:', e.message);
    }

    return items;
  }

  function scrapeItemsFromDOM() {
    return scrapeItemsFromDoc(document);
  }

  function scrapeItemsFromDoc(doc) {
    const items = [];
    const seen = new Set();

    // パターン1: /item/{id} 形式のリンク
    const links = [...doc.querySelectorAll('a[href*="/item/"]')];
    for (const a of links) {
      const m = a.href.match(/\/item\/([a-zA-Z0-9_-]+)(?:\/|$|\?)/);
      if (!m) continue;
      const id = m[1];
      if (id === 'new' || seen.has(id)) continue;
      seen.add(id);
      // タイトルは近くのテキストノードから取得
      const titleEl = a.querySelector('p, span, div, h2, h3') || a;
      const title = titleEl.textContent.trim().substring(0, 50) || ('商品 ' + id);
      const imgEl = a.querySelector('img');
      const thumb = imgEl ? (imgEl.src || imgEl.dataset.src || '') : '';
      items.push({ id, title, thumb });
    }

    // パターン2: data-item-id 属性
    const dataEls = [...doc.querySelectorAll('[data-item-id]')];
    for (const el of dataEls) {
      const id = el.dataset.itemId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const titleEl = el.querySelector('p, span, div') || el;
      const title = titleEl.textContent.trim().substring(0, 50) || ('商品 ' + id);
      const imgEl = el.querySelector('img');
      const thumb = imgEl ? (imgEl.src || '') : '';
      items.push({ id, title, thumb });
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
      if (itemData.brandName && itemData.brandName !== 'ブラントなし' && itemData.brandName !== 'ブラント') {
        await selectBrand(itemData.brandName);
      }
      await sleep(500);

      log('確認ボタンを押します...');
      const confirmBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '確認する');
      if (!confirmBtn) { log('⚠ 確認ボタンが見つかりません'); return false; }
      confirmBtn.scrollIntoView();
      await sleep(300);
      cۙ�\�P����X��
N���8�#9a�d�x�fx���#x��8�����हo�x�i;�"9� 9i)�My���"B���	�论*�x����8�:`m����o�x�hK����N�ۜ��X�Z]��H]�Z]�]���Z\�J�\���HO�]�H�ۜ�H�][�\��[


HO�����ۜ���Hˋ����[Y[��]Y\�T�[X�ܐ[
	؝]ۉ�WK��[�
�O����^�۝[���[J
HOOH	�a�d�x�fx������^�۝[���[J
HOOH	���:)��a�d�x�fx������^�۝[���[J
HOOH	�a�d�xह��:)���n�c,��fx��
NY�
��H��X\�[�\��[

N��\���J��N�B�Y�
���
H��X\�[�\��[

N��\���J�[
N�B�K
L
NJN�Y�
�X�Z]��H�X�Z]����ܛ�[�՚Y]�
N]�Z]�Y\
�
N�X�Z]����X��
N��	��!H9a�d�yk�9.��� I�N]�Z]�Y\
�
N�]\���YNH[�H��	���9a�d�x��8������c:)���i8�b�ࢸ�o��f����N�]\���[�NB�H�]�
JH��	��c8��x�x��8��9aiyb���8��x���	�
�K�Y\��Y�JN�]\���[�NB�B����OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB���8����8��8���`n9�����8�����x�����OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB��\�[���[��[ۈ�[X��]Y�ܞJ�]Y�ܞT]
H��	������8��`n9����	�
��]Y�ܞT]
N�ۜ�X�[�H�]Y�ܞT]��]
ψ��K�X\
�O�˝�[J
JK��[\����X[�NY�
[X�[˛[��
H�]\���ۜ��]��Hˋ����[Y[��]Y\�T�[X�ܐ[
	؝]ۉ�WK��[�
�O����^�۝[��[��Y\�	ω�H�����\�
	���\�ʏH��]Y�ܞH�I�B�
NY�
X�]��H�]\���]����X��
N]�Z]�Y\

N�H�ۜ�[�[H]�Z]�Z]�܊	˘�ZܘKYX[�����۝[�	�
L
N�܈
�ۜ�X�[وX�[�H]�Z]�Y\


N�ۜ���Hˋ��[�[�]Y\�T�[X�ܐ[
	؝]ۉ�WK��[�
�O��ۜ�^Hˋ�����[��\�K��[\��O�����U\HOOH�K�X\
�O���^�۝[���[J
JK���[�	��N�]\��^OOHX�[��^�۝[���[J
HOOHX�[JNY�
��H����X��
NB�H�]�
JH���	������8������8��8����8��x���	�
�K�Y\��Y�JN�B�B��\�[���[��[ۈ�[X��\[��Y]�
Y]��[YJH��	�acz` y��y��z`n9����	�
�Y]��[YJN�ۜ��\��Hˋ����[Y[��]Y\�T�[X�ܐ[
	؝]ۉ�WK��[�
�O�������\�
	���\�ʏH��\[��[Y]��K��\�ʏH��\[��Y]��I�H���^�۝[��[��Y\�	�acz` y��y��xऺ`n9����B�
NY�
\�\��H�]\���\����X��
N]�Z]�Y\

N�H�ۜ�[�[H]�Z]�Z]�܊	˘�ZܘKYX[�����۝[�	�
L
N�ۜ�\��]Hˋ��[�[�]Y\�T�[X�ܐ[
	؝]ۋ�[�X�[	�WK��[�
[O��ۜ�^Hˋ��[��[��\�K��[\��O�����U\HOOH�K�X\
�O���^�۝[���[J
JK���[�	��N�]\��^OOHY]��[YH[�^�۝[���[J
HOOHY]��[YNJNY�
\��]
H\��]��X��
N�ۜ�\�[�H\��]����\�
	؝]ۉ�H\��]�\�[�[[Y[�Y�
\�[�	��\�[�OOH\��]
H\�[���X��
NB�H�]�
JH���	�acz` y��y��x����8��8����8��x���	�
�K�Y\��Y�JN�B�B��\�[���[��[ۈ�[X���[�
��[��[YJH��	�����x�����z`n9����	�
���[��[YJN�ۜ���[���Hˋ����[Y[��]Y\�T�[X�ܐ[
	؝]ۉ�WK��[�
�O������\�
	���\�ʏH���[��I�JNY�
X��[���H�]\����[�����X��
N]�Z]�Y\

N�H�ۜ�[�[H]�Z]�Z]�܊	˘�ZܘKYX[�����۝[�	�
L
N�ۜ��X\��[�]H[�[�]Y\�T�[X�܊	�[�]�\OH�^�K[�]�\OH��X\���I�NY�
�X\��[�]
H�][�]
�X\��[�]��[��[YJN]�Z]�Y\

N�ۜ��\�[Hˋ��[�[�]Y\�T�[X�ܐ[
	؝]ۋI�WK��[�
[O�[�^�۝[���[J
HOOH��[��[YJNY�
�\�[
H�\�[��X��
NB�H�]�
JH���	�����x�����x����8��8����8��x���	�
�K�Y\��Y�JN�B�B����OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB���9bb�fi9a��!����OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB��\�[���[��[ۈ[]R][JY
H��	�a�d�ybb�fi9.+N�	�
�Y��X���[��
H
�	ˋ���N�ۜ��ܙ�H��[Y[��]Y\�T�[X�܊	�Y]Vۘ[YOH��ܙ�]��[��I�O˙�]]�X�]J	��۝[�	�NY�
X�ܙ�H���	��ԑ���8��8�����c�o��i,y�e��N��]\���[�N�B��ۜ��ܛHH��[Y[��ܙX]Q[[Y[�
	ٛܛI�N�ܛK�Y]�H	���	��ܛK�X�[ۈH	��][K��
�Y�ܛK��[K�\�^HH	ۛۙI��ۜ�HH��[Y[��ܙX]Q[[Y[�
	�[�]	�N�K�\HH	�Y[���K��[YHH	��Y]�	��K��[YHH	�[]I��ۜ�H��[Y[��ܙX]Q[[Y[�
	�[�]	�N��\HH	�Y[�����[YHH	�]][�X�]W���[�����[YHH�ܙ��ܛK�\[��[
JN��ܛK�\[��[

N��[Y[����K�\[��[
�ܛJN�ܛK��X�Z]

N�]\���YNB����OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB���8��x�8����8�������{�"8����8�8स�o��g��a8�i�⭹�b��y�!��"B���OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB��\�[���[��[ۈ�[��؊
H�ۜ��؈H�]�؊
NY�
Z�؊H�]\���[�N�ۜ�]H��][ۋ�]�[YN���KKH�][K��YK�Y]�9��:f�����8�8�i������8����ya�KKB��ۜ�Y]X]�H]�X]�
ח�][W�׋�J�W�Y]	�NY�
Y]X]�
H�ۜ�YHY]X]��WN�ۜ��ؒ][HH�؋�][\˙�[�
HO�K�YOOHY
NY�
Z�ؒ][JH�]\���[�N�[��X��[\�
N�����ܙ\��[�[
�؊N��	������8��c�o��.+N�	�
�Y��X���[��
H
�	ˋ���N����XX�8�k���8�����8������8हo�x�i��H]�Z]�Z]�܊	��X�Z�\�H�9���ke��o��iȗK�X^[��H��I�ML
NH�]�
JH���	���8��x�x��8��:*�x�o�/�8�o����8��8ਸ੸��	�N�B�]�Z]�Y\

L
N��ۜ�]HH^�X��\��[�][Q]JY
NY�
]K�]JH��	��$�9c�o�Έ	�
�]K�]K��X���[���
JN�ؒ][K�]HH]N�]�R�؊�؊NH[�H��	���8�����8��c�o��i,y�e��"8���8��8����j��e��"x� x�x�x�������e��o��fI�N�ؒ][K�]HH�[�ؒ][K��[\�YH�[�N�]�R�؊�؊NB����9�(x�k�ਸ����������ۜ��^Y]H�؋�][\˙�[�
HO�K�]HOOH�[	��K�YOOHY
NY�
�^Y]
H��][ۋ��Y�H	��][K��
��^Y]�Y
�	��Y]	�H[�H�ۜ��\��[�[��H�؋�][\˙�[�
HO�K�]H	��ZK��[\�Y
NY�
�\��[�[��H��][ۋ��Y�H	��][Kۙ]��H[�H�X\��؊
N��	�a�d�x�fx��ea�d�x�c8�`�ࢸ�o��f����NB�B��]\���YNB����KKH�][Kۙ]Έ9��:)��a�d�x��x�x��8��9aiyb��KKB�Y�
]OOH	��][Kۙ]��H�ۜ��\��[�][HH�؋�][\˙�[�
HO�K�]H	��ZK��[\�Y
NY�
X�\��[�][JH��X\��؊
N��]\���[�N�B��[��X��[\�
N�����ܙ\��[�[
�؊N��	�a�d�y.+N�	�
��\��[�][K�]K�]K��X���[���
JN��ۜ��X��\��H]�Z]�[�]�][Q�ܛJ�\��[�][K�]JN�\��[�][K��[\�YH�X��\���]�R�؊�؊N�Y�
�X��\��	���؋�[]SܚY�[�[�H��9bb�fi8�k�����8�:`m�����fx���k��i��d��d��i��`���ࢻ�"��[8�j��.��h��i��b��ybb�fi8��x����8஻�"B��؋�\�HH	�[]I��]�R�؊�؊N��9�(x�k��*�a�d�x�c8�`��8�l9ab8�j�a�d�x�fx��ۜ��^H�؋�][\˙�[�
HO�K�]H	��ZK��[\�Y
NY�
�^
H��][ۋ��Y�H	��][Kۙ]��H[�H��][ۋ��Y�H	���[	�B��]\���YNB��Y�[��R�؊�؊N�]\���YNB����KKH��[�9bb�fi8��x����8ஈKKB�Y�

]OOH	���[	�]OOH	���[��H	���؋�\�HOOH	�[]I�H[��X��[\�
N�����ܙ\��[�[
�؊N�ۜ��[]HH�؋�][\˙�[�
HO�K��[\�Y	��ZK�[]Y
NY�
�[]JH]�Z][]R][J�[]K�Y
N�[]K�[]YH�YN�]�R�؊�؊N�]\���YNB��X\��؊
N��	��!H8�fx�nx�i�k�9.���e��o��e��g�� I�N�����\]SY\��Y�J
N�]\���YNB���]\���[�NB���[��[ۈY�[��R�؊�؊H�ۜ��^H�؋�][\˙�[�
HO�K�]H	��ZK��[\�Y
NY�
�^
H�]�R�؊�؊N��][ۋ��Y�H	��][Kۙ]��H[�H�X\��؊
N��	��!H9aj9a�ya�d�x�c9k�9.���e��o��e��g�� I�N�����\]SY\��Y�J
NB�B����OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB���RB���OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB���[��[ۈ[��X��[\�
HY�
��[Y[���][[Y[��RY
	ܜ�\�[\��JH�]\���ۜ��H��[Y[��ܙX]Q[[Y[�
	��[I�N˚YH	ܜ�\�[\��˝^�۝[�H�ܜ�\[�[���][ێ��^Y����ܚY�����Y�̌ؘX��ܛ�[��ٙ��؛ܙ\�\�Y]\ΌL�؛�\�Y�Ό���ؘJ��NދZ[�^�NNNNNٛ۝Y�[Z[N��[��\�\�Y��ݙ\���ΚY[�B�ܜ�ZXY\��\�^N��^ڝ\�Y�KX�۝[���X�KX�]�Y[��[YۋZ][\Θ�[�\��Y[�ΌL�M�ؘX��ܛ�[��Б�L���܎�ٙ��ٛ۝]�ZY����B�ܜ�X���^ؘX��ܛ�[���ۙN؛ܙ\���ۙN���܎�ٙ��ٛ۝\�^�N�N��\��܎��[�\�B�ܜ�X��^�Y[�ΌM��X^ZZY��L�ݙ\����^N�]]�B�ܜ�Z][K[\��\�\�[N��ۙN�X\��[���Y[�ΌB�ܜ�Z][K[\�^�\�^N��^�[YۋZ][\Θ�[�\���\��Y[�΍�؛ܙ\�X���N�\��Y�YY_B�ܜ�Z][K[\�[Y���Y��ZY���ؚ�X�Y�]��ݙ\�؛ܙ\�\�Y]\΍B�ܜ�[�[ۜ��X\��[�]��L��Y[��]��L�؛ܙ\�]��\��Y�YY_B�ܜ�\�\�X����Y�L	N�X\��[�]��L��Y[�ΌLؘX��ܛ�[��Б�L���܎�ٙ��؛ܙ\���ۙN؛ܙ\�\�Y]\Ύٛ۝\�^�N�M��\��܎��[�\�ٛ۝]�ZY����B�ܜ�\�\�X���\�X�YؘX��ܛ�[��������\��܎���X[��YB�ܜ�[���X^ZZY��ML�ݙ\����^N�]]�ٛ۝\�^�N�L\���܎�͍���X\��[�]��B�ܜ�[���X\��[���B����\�[X�X[��\��܎��[�\����܎�Б�L�^YX�ܘ][ێ�[�\�[�_B�ܜ�\��ܙ\��X�\�ؘX��ܛ�[���YYN؛ܙ\�\�Y]\΍�ZY���X\��[�]��B�ܜ�\��ܙ\��Y�[ؘX��ܛ�[��Б�L�ZY��L	N؛ܙ\�\�Y]\΍��[��][ێ��Y���B���[Y[��XY�\[��[
�NB���[��[ۈ��\��H�ۜ�[H��[Y[���][[Y[��RY
	ܜ�[���NY�
Y[
H��ۜ��K���	�Ԕ�H	�
�\��N��]\���B��ۜ�H��[Y[��ܙX]Q[[Y[�
	�	�N�^�۝[�H\��[�\[��[

N[��ܛ��H[��ܛ�ZY�B���[��[ۈ�����ܙ\��[�[
�؊H][�[H��[Y[���][[Y[��RY
	ܜ�\[�[	�NY�
\[�[
H[��X��[\�
N[�[H��[Y[��ܙX]Q[[Y[�
	�]��N[�[�YH	ܜ�\[�[	�[�[�[��\�SH	�]�YH���ZXY\����[��'�!8��x����a�ya�d�x��8��8�����[���]ۈYH���X���H���%O؝]ۏ��]��]�YH���X��H��]�YH���\��ܙ\�ȏ�]�YH���\��ܙ\��]^��a��!�.+K����]��]�YH���\��ܙ\��X�\���]�YH���\��ܙ\��Y�[��[OH��Y�	H���]���]���]��]�YH���[�ȏ��]���]�����[Y[����K�\[��[
[�[
N��[Y[���][[Y[��RY
	ܜ�X���I�K�ۘ�X��H

HO�[�[��[[ݙJ
NB��ۜ�ۙHH�؋�][\˙�[\�HO�K��[\�Y
K�[���ۜ��[H�؋�][\˛[���ۜ��[H��[Y[���][[Y[��RY
	ܜ�\��ܙ\��Y�[	�N�ۜ�^H��[Y[���][[Y[��RY
	ܜ�\��ܙ\��]^	�NY�
�[
H�[��[K��YHX]���[�
ۙH��[
�L
H
�	�I�Y�
^
H^�^�۝[�HۙH
�	��	�
��[
�	�9.��k�9.���B���[��[ۈ�����\]SY\��Y�J
H][�[H��[Y[���][[Y[��RY
	ܜ�\[�[	�NY�
\[�[
H�[��X��[\�
N�[�[H��[Y[��ܙX]Q[[Y[�
	�]��N�[�[�YH	ܜ�\[�[	����[Y[����K�\[��[
[�[
N�B�[�[�[��\�SH	�]�YH���ZXY\����[��'�!8��x����a�ya�d�x��8��8�����[���]ۈYH���X���H���%O؝]ۏ��]��]�YH���X��H��[OH�^X[Yێ��[�\��Y[�Ό�M���]��[OH��۝\�^�N����!O�]��]��[OH��۝\�^�N�M�ٛ۝]�ZY�����X\��[�]����a�ya�d�x�c9k�9.���e��o��e��g�� O�]���]ۈۘ�X��H���[Y[���][[Y[��RY
	ܜ�\[�[	�K��[[ݙJ
H��[OH�X\��[�]��M��Y[�Ύ�ؘX��ܛ�[��Б�L���܎�ٙ��؛ܙ\���ۙN؛ܙ\�\�Y]\Ύ��\��܎��[�\�ٛ۝\�^�N�M��e�x�f8��؝]ۏ��]�����[Y[���][[Y[��RY
	ܜ�X���I�K�ۘ�X��H

HO�[�[��[[ݙJ
NB��\�[���[��[ۈ���XZ[�RJ
H[��X��[\�
N��[Y[���][[Y[��RY
	ܜ�\[�[	�O˜�[[ݙJ
N��ۜ�[�[H��[Y[��ܙX]Q[[Y[�
	�]��N[�[�YH	ܜ�\[�[	�[�[�[��\�SH�]�YH���ZXY\�����[��'�!8��x����a�ya�d�x��8��8�����[����]ۈYH���X���H���%O؝]ۏ���]���]�YH���X��H���]��[OH���܎�͍��ٛ۝\�^�N�L��X\��[�X���N����9a�ya�d�x�fx��ea�d�xऺ`n8���i��c��h8�ex�a��[��\��H���\�[X�X[�YH���\�[X�X[���"8�fx�nx�i�`n9����"O��[����]���]��[OH�^X[Yێ��[�\��Y[�ΌM����܎��NNH�YH���[�Y[�ȏ�*�x�o�/�8�o�.+K����]���[YH���Z][K[\����[��]�YH���[�[ۜȏ��X�[�[�]\OH��X�؛��YH���Y[]K[ܚYȏ�9a`��k�a�d�xहbb�fi8�fx���X�[���]����]ۈYH���\�\�X���\�X�Y�ea�d�xऺ`n8���i��c��h8�ex�a؝]ۏ��]�YH���[�ȏ��]����]�����[Y[����K�\[��[
[�[
N��[Y[���][[Y[��RY
	ܜ�X���I�K�ۘ�X��H

HO�[�[��[[ݙJ
N���	�a�d�y.+x�k�ea�d�xहc�o��.+K����N]][\�H�N�H�][\�H]�Z]�]��[][\�
N�B��]�
JH���	�c�o���8��x���	�
�K�Y\��Y�JN�B����[Y[���][[Y[��RY
	ܜ�[�Y[���O˜�[[ݙJ
N�ۜ�\�H��[Y[���][[Y[��RY
	ܜ�Z][K[\�	�N�Y�
][\˛[��OOH
H\��[��\�SH	�H�[OH���܎��NNN�Y[�Ύ��a�d�y.+x�k�ea�d�x�c:)���i8�b�ࢸ�o��f����O���]\��B���	�ea�d�x���x��:*�x�o�/�8�o�k�9.���	�
�][\˛[��
�	�.��N��܈
�ۜ�][Hو][\�H�ۜ�HH��[Y[��ܙX]Q[[Y[�
	�I�NK�[��\�SH[�]\OH��X�؛��YH���X؋I�][K�YH��[YOH��][K�YH���][K�[X��[Y�ܘ�H��][K�[X�H�[H����	��OX�[�܏H���X؋I�][K�YH���][K�]_O�X�[�\��\[��[
JNB��\��Y]�[�\�[�\�	��[��I�\]P��N�[��[ۈ\]P��
H�ۜ��H\��]Y\�T�[X�ܐ[
	�[�]��X��Y	�K�[���ۜ���H��[Y[���][[Y[��RY
	ܜ�\�\�X���N���^�۝[�H����
�	�.��हa�ya�d�x�fx����	�ea�d�xऺ`n8���i��c��h8�ex�a	����\�X�YH�OOHB����[Y[���][[Y[��RY
	ܜ�\�[X�X[	�K�ۘ�X��H

HO�\��]Y\�T�[X�ܐ[
	�[�]�\OH��X�؛��I�K��ܑXX�
؈O�؋��X��YH�YJN\]P��
NN���[Y[���][[Y[��RY
	ܜ�\�\�X���K�ۘ�X��H

HO��ۜ��[X�YY�Hˋ��\��]Y\�T�[X�ܐ[
	�[�]��X��Y	�WK�X\
؈O�؋��[YJN�ۜ�[]SܚY�[�[�H��[Y[���][[Y[��RY
	ܜ�Y[]K[ܚY��K��X��Y�ۜ��؈H\�N�	ܙ[\�	��[]SܚY�[�[��][\Έ�[X�YY˛X\
YO�
�Y]N��[�[\�Y��[�K[]Y��[�HJJB�N�]�R�؊�؊N��	�e��i�Έ	�
��[X�YY˛[��
�	�.�8���9��:f�����8�8�n9���b�y.+K����N��][ۋ��Y�H	��][K��
��[X�YY��H
�	��Y]	�NB����OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB���8�8�����8����8��x�8��������OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOB��
\�[���[��[ۈXZ[�
H�ۜ��؈H�]�؊
NY�
�؊H�ۜ�[�YH]�Z]�[��؊
NY�
[�Y
H�]\��Y�
�ۙ�\�J	�a�ya�d�ya��!��c9.+y��x�ex�8�i��a8�o��fx� ���x������������e��i�� 9b'x�b��x�a8ࢹ��8�e��o��fx�b��'��JH�X\��؊
NB�B�Y�
��][ۋ�]�[YHOOH	���[	���][ۋ�]�[YHOOH	���[��H]�Z]���XZ[�RJ
N�]\��B�[\�
	��d��k���8��8����k�΋�ٜ�[����[8�i�-m�b�x�e��i��c��h8�ex�a8� �����g*8�k�����8�8�j����b�x�e��o��fx� ��N��][ۋ��Y�H	���[	�JJ
N�JJ
N�
