// Отдельные окна: добавление, переименование подписки, свои домены и
// сканер QR. Перенос AddSheet.swift и QRScannerView.swift.

import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { useApp, font, px, Sheet, Segmented, TextField, TextArea, AccentButton, OutlineButton, DangerButton, Spinner, Confirm } from './ui.js';
import { s, css } from './theme.js';
import { t } from './i18n.js';

// ---------------------------------------------------------------------------
// Добавить
// ---------------------------------------------------------------------------

export function AddSheet({ initialMode, onClose }) {
  const { palette: p, act } = useApp();
  const [mode, setMode] = useState(initialMode);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);
  const [result, setResult] = useState(null);

  const isEmpty = mode === 'subscription' ? !url.trim() : !text.trim();

  const submit = async () => {
    if (working || isEmpty) return;
    setProblem(null);
    setResult(null);
    if (mode === 'subscription') {
      setWorking(true);
      const outcome = await act('addSubscription', url, name);
      setWorking(false);
      if (outcome.ok) {
        onClose();
      } else {
        setProblem(outcome.problem);
      }
    } else {
      const outcome = await act('addLinks', text);
      setProblem(outcome.errors[0] || null);
      if (outcome.parsedCount > 0 && outcome.errors.length === 0) {
        onClose();
      } else {
        setResult(outcome.added > 0 ? t(`Добавлено узлов: ${outcome.added}`, `Nodes added: ${outcome.added}`) : null);
      }
    }
  };

  const hint = font('body', 11, { color: css(p.textSecondary), lineHeight: 1.3 });

  return html`
    <${Sheet} title=${t('Добавить', 'Add')} onClose=${onClose} footer=${html`
      ${working && html`<${Spinner} small /><span style=${font('code', 10, { color: css(p.textSecondary) })}>${t('Загружаю…', 'Loading…')}</span>`}
      <span class="spacer" />
      <${OutlineButton} onClick=${onClose}>${t('Закрыть', 'Close')}<//>
      <${AccentButton} onClick=${submit} disabled=${working || isEmpty}>${mode === 'subscription' ? t('Загрузить', 'Load') : t('Добавить', 'Add')}<//>`}>

      <${Segmented} value=${mode} onChange=${setMode} options=${[
        { value: 'subscription', title: t('Подписка', 'Subscription') },
        { value: 'links', title: t('Ссылки', 'Links') }
      ]} />

      ${mode === 'subscription' ? html`
        <div class="col" style=${{ gap: px(s(8)) }}>
          <span style=${hint}>${t('Узлы подтянутся сразу и дальше будут обновляться сами: добавленные ', 'Nodes are pulled in at once and keep updating themselves: the ones added ')
            + t('и удалённые на панели появятся и исчезнут здесь.', 'and removed on the panel appear and disappear here.')}</span>
          <${TextField} placeholder="https://…" value=${url} onInput=${setUrl} monospaced autoFocus onEnter=${submit} />
          <${TextField} placeholder=${t('Название — можно задать своё', 'Name — you can set your own')} value=${name} onInput=${setName} onEnter=${submit} />
        </div>` : html`
        <div class="col" style=${{ gap: px(s(8)) }}>
          <span style=${hint}>${t('Такие узлы живут отдельно от подписок и сами не обновляются.', 'Such nodes live apart from subscriptions and do not update themselves.')}</span>
          <${TextArea} value=${text} onInput=${setText} height=${s(140)} autoFocus />
        </div>`}

      <span style=${font('body', 10.5, { color: css(p.textSecondary, 0.75), lineHeight: 1.3 })}>
        ${mode === 'subscription'
          ? t('Ссылка из буфера или с QR-кода добавляется сразу — через меню на «плюсе».', 'A link from the clipboard or a QR code is added right away — from the “plus” menu.')
          : t('Одна или несколько ссылок, по одной в строке.', 'One or more links, one per line.')}
      </span>

      ${result && html`<div class="row" style=${font('body', 11, { color: css(p.accentStart), gap: '6px' })}><${Icon} name="checkmark.circle.fill" size=${13} />${result}</div>`}
      ${problem && html`<div class="row" style=${font('body', 11, { color: css(p.bad), gap: '6px', alignItems: 'flex-start' })}><${Icon} name="exclamationmark.triangle.fill" size=${13} style="margin-top:1px" /><span>${problem}</span></div>`}
    <//>`;
}

// ---------------------------------------------------------------------------
// Переименование подписки
// ---------------------------------------------------------------------------

export function RenameSheet({ subscription, onClose }) {
  const { act } = useApp();
  const [name, setName] = useState(subscription.name || '');
  const save = () => {
    act('renameSubscription', subscription.id, name.trim());
    onClose();
  };
  return html`
    <${Sheet} title=${t('Название подписки', 'Subscription name')}
              subtitle=${t('Имя видно только тебе. Пустое поле вернёт то, что присылает панель.', 'The name is visible only to you. An empty field restores what the panel sends.')}
              onClose=${onClose} footer=${html`
      <span class="spacer" />
      <${OutlineButton} onClick=${onClose}>${t('Отмена', 'Cancel')}<//>
      <${AccentButton} onClick=${save}>${t('Сохранить', 'Save')}<//>`}>
      <${TextField} placeholder=${subscription.displayName} value=${name} onInput=${setName} autoFocus onEnter=${save} />
    <//>`;
}

// ---------------------------------------------------------------------------
// Свои домены
// ---------------------------------------------------------------------------

const normalized = (value) => value.split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean);

export function DirectDomainsSheet({ onClose }) {
  const { palette: p, state, act } = useApp();
  const original = (state.settings.routing.directDomains || []).join('\n');
  const [text, setText] = useState(original);
  const [confirming, setConfirming] = useState(false);
  const hasChanges = normalized(text).join('\n') !== normalized(original).join('\n');

  const save = () => {
    act('setDirectDomains', normalized(text));
    onClose();
  };
  const close = () => (hasChanges ? setConfirming(true) : onClose());

  return html`
    <${Sheet} title=${t('Свои домены напрямую', 'Own domains direct')}
              subtitle=${t('Внутренние адреса: почта, вики, файловый сервер. Они пойдут мимо ', 'Internal addresses: mail, wiki, file server. They go around the ')
                + t('туннеля и будут резолвиться системным DNS — публичные резолверы ', 'tunnel and resolve through the system DNS — public resolvers ')
                + t('о таких именах не знают. По одному в строке.', 'do not know such names. One per line.')}
              onClose=${close} footer=${html`
      ${hasChanges && html`<span style=${font('code', 10, { color: css(p.warn) })}>${t('Есть несохранённые изменения', 'There are unsaved changes')}</span>`}
      <span class="spacer" />
      <${OutlineButton} onClick=${close}>${t('Закрыть', 'Close')}<//>
      <${AccentButton} onClick=${save} disabled=${!hasChanges}>${t('Сохранить', 'Save')}<//>`}>
      <${TextArea} value=${text} onInput=${setText} height=${s(150)} autoFocus />
      <span style=${font('code', 10, { color: css(p.textSecondary, 0.7) })}>${t('Например: vexch01.uvi.lan', 'For example: vexch01.uvi.lan')}</span>
    <//>
    ${confirming && html`
      <${Confirm} title=${t('Изменения не сохранены', 'Changes are not saved')}
                  message=${t('Список доменов изменён. Закрыть без сохранения?', 'The domain list has changed. Close without saving?')}
                  onCancel=${() => setConfirming(false)}
                  buttons=${[
                    { title: t('Сохранить и закрыть', 'Save and close'), role: 'default', action: save },
                    { title: t('Закрыть без сохранения', 'Close without saving'), role: 'destructive', action: onClose },
                    { title: t('Отмена', 'Cancel'), action: () => setConfirming(false) }
                  ]} />`}`;
}

// ---------------------------------------------------------------------------
// Сканер QR
// ---------------------------------------------------------------------------

const SEARCH_WINDOW = 20;

/** Разбор картинки (dataURL) — буфер обмена и файл. */
export async function decodeImage(dataURL) {
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  // Крупные скриншоты уменьшаем: распознавание не выигрывает от лишних
  // пикселей, а время растёт квадратично.
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = window.jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
  return code && code.data ? code.data : null;
}

export function QRScannerSheet({ onFound, onClose }) {
  const { palette: p, act } = useApp();
  const [phase, setPhase] = useState({ kind: 'idle' });
  const [secondsLeft, setSecondsLeft] = useState(SEARCH_WINDOW);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let frame = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const scan = () => {
      raf = requestAnimationFrame(scan);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || doneRef.current) return;
      // Разбирать каждый кадр незачем — код никуда не убегает.
      frame += 1;
      if (frame % 4 !== 0) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const k = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        doneRef.current = true;
        onFound(code.data);
        onClose();
      }
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setPhase({ kind: 'running' });
        requestAnimationFrame(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        });
        raf = requestAnimationFrame(scan);
      } catch (error) {
        if (cancelled) return;
        const name = error && error.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') setPhase({ kind: 'denied' });
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setPhase({ kind: 'failed', text: t('Камера не найдена.', 'No camera found.') });
        else if (name === 'NotReadableError') setPhase({ kind: 'failed', text: t('Камера занята другим приложением.', 'The camera is busy in another app.') });
        else setPhase({ kind: 'failed', text: String((error && error.message) || error) });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Отсчёт идёт только пока камера действительно смотрит.
  useEffect(() => {
    if (phase.kind !== 'running') return undefined;
    const id = setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          clearInterval(id);
          setTimeout(onClose, 0);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase.kind]);

  const message = (text) => html`
    <span style=${font('body', 11.5, { color: css(p.textSecondary), textAlign: 'center', padding: '24px', lineHeight: 1.35, position: 'relative' })}>${text}</span>`;

  return html`
    <${Sheet} title=${t('Сканировать QR', 'Scan QR')}
              subtitle=${t('Поднеси код к камере — распознается сам.', 'Hold the code up to the camera — it is picked up on its own.')}
              onClose=${onClose} footer=${html`
      ${phase.kind === 'running' && html`
        <span class="row" style=${{ gap: '6px', color: css(p.textSecondary) }}>
          <span style=${font('code', 8.5, { letterSpacing: '1px' })}>${t('ПОИСК', 'SEARCH')}</span>
          <span class="tabular" style=${font('code', 9.5)}>${secondsLeft} ${t('с', 's')}</span>
        </span>`}
      <span class="spacer" />
      <${DangerButton} onClick=${onClose}>${t('Закрыть', 'Close')}<//>`}>

      <div class="scanner">
        ${phase.kind === 'running' && html`<video ref=${videoRef} muted playsinline />`}
        ${phase.kind === 'idle' && message(t('Запрашиваю доступ к камере…', 'Requesting camera access…'))}
        ${phase.kind === 'denied' && message(t('Нет доступа к камере. Разреши его в «Параметрах Windows» → ', 'No camera access. Allow it in Windows Settings → ')
          + t('«Конфиденциальность и защита» → «Камера», затем открой окно заново.', 'Privacy & security → Camera, then open this window again.'))}
        ${phase.kind === 'failed' && message(phase.text)}
        <div class="aim" />
      </div>

      ${phase.kind === 'denied' && html`
        <div><${OutlineButton} onClick=${() => act('openCameraSettings')}>${t('Открыть настройки доступа', 'Open privacy settings')}<//></div>`}
    <//>`;
}
