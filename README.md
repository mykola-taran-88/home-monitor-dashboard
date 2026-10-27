# Home Monitor Dashboard 4.0.0

Редизайн поточного Home Monitor у межах наявного Cloudflare Worker. Проєкт зберігає чинний API host, адміністративну зону, авторизацію та Chart.js. Це HTML/CSS/vanilla JavaScript застосунок, а не React/TypeScript-проєкт; тому збірка не вводить новий framework і не вимагає нових runtime-залежностей.

## Структура

- `index.js` — згенерований Worker, який можна завантажити замість чинного коду Worker після перевірки в staging.
- `src/index.html` — вихідна HTML-структура й page shells.
- `src/styles.css` — єдиний CSS source: legacy-стилі, централізовані design tokens та адаптивні правила нового UI.
- `src/scripts/core.js` — збережений API-клієнт, сесія, адміністративні flows, timeline і наявна бізнес-логіка.
- `src/scripts/dashboard.js` — новий шар UI, adapters, стани даних, SVG-план, snapshots, графічні режими та deep links.
- `scripts/build.mjs` — вставляє HTML/CSS/JS у шаблон та генерує `dist/index.html` і root `index.js`.
- `scripts/quality-check.mjs`, `scripts/lint.mjs` — перевірки синтаксису JavaScript, шаблонних маркерів, основних контрактів та ID.
- `scripts/typecheck.mjs` — перевіряє наявність TypeScript-коду; за поточної vanilla JS-архітектури явно повідомляє, що TypeScript typecheck не застосовується.
- `tests/worker.test.mjs` — перевірки маршрутів і базової поведінки Worker.
- `docs/` — аудит, підсумок, API gaps, тестовий звіт та міграційні нотатки.

## Вимоги

- Node.js 20 або новіший для локальної збірки та тестів.
- Cloudflare Workers Runtime для розгортання.
- Chart.js 4.5.1 як і раніше завантажується з CDN `cdnjs.cloudflare.com`.
- Backend API: `https://smart-home-api-v2.mykola-taran-88.workers.dev/api/v1`.
- Нових npm runtime-залежностей немає.

## Локальна перевірка

```bash
npm run build
npm run lint
npm run typecheck
npm test
# агрегована перевірка збірки й статичних правил:
npm run check
```

`npm run typecheck` не є перевіркою типів: у наданому коді немає TypeScript/TSX або `tsconfig.json`. Ця команда вказує на це обмеження; JavaScript syntax перевіряє `npm run lint`.

Редагуйте source-файли у `src/`, а не Base64 у `index.js`. Команда `npm run build` створює standalone `dist/index.html` і deployable `index.js`.

## Розгортання

Спочатку завантажте згенерований Worker у staging і перевірте його з реальним backend. Для production використовуйте той самий Cloudflare Worker, зберігаючи наявні secrets, bindings, домен і environment settings. Wrangler/CI конфігурації серед вкладень не було, тому цей репозиторій не додає припущеного deploy-конфігу.

Worker віддає app для `/`, `/index.html`, `/home`, `/climate`, `/energy`, `/weather`, `/devices`, `/devices/:id`, `/timeline`, `/admin` і `/about`. Невідомі шляхи повертають `404`, методи поза `GET`/`HEAD` — `405`.

## Дані й обмеження

Інтерфейс використовує наявні відповіді backend і не генерує випадкових sensor/device/forecast значень. Відсутні числові показники відображаються як `—`, а підтверджений нуль лишається нулем. Тарифні зони/stacked series, мережеві показники й частина погодних деталей потребують реальних полів API; відсутні поля перелічено в `docs/api-gaps.md`.

Browser E2E, реальні backend payloads, permission checks і physical device accessibility не були доступні в цьому середовищі. Точний обсяг автоматичних перевірок та обмеження описані в `docs/testing-report.md`.
