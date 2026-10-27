# Звіт перевірок

**Дата:** 27 жовтня 2026 року. **Середовище:** Node.js 22.16.0, Linux container.

## Автоматизовані перевірки

| Перевірка | Результат | Межі перевірки |
|---|---|---|
| `npm run build` | Пройшла | Створює `dist/index.html` і root `index.js` із source-файлів |
| `npm run lint` | Пройшла | Custom syntax/static checks; це не ESLint |
| Worker ESM syntax (`node --check index.js`) | Пройшла | Перевірено синтаксис згенерованого Worker |
| Inline/source JavaScript syntax | Пройшла | `core.js` і `dashboard.js` перевіряються через `vm.Script` |
| Static HTML/source checks | Пройшла | 137 унікальних статичних ID, без повторів; markers і важливі selectors/contracts присутні |
| Scanned floor-plan dependency | Пройшла | У джерелі немає посилання на `floor-plan.png` |
| Worker route smoke tests | Пройшла | 12 підтримуваних URL, включно з query parameters/deep links |
| Method/error tests | Пройшла | `HEAD` без body, невідомий шлях `404`, заборонений метод `405` |
| `npm test` | Пройшла | 13/13 тестів: 8 acceptance/regression перевірок за ТЗ і 5 Worker HTTP/security тестів |
| `npm run typecheck` | Не застосовується | TypeScript/TSX і `tsconfig.json` у цьому vanilla JS-проєкті відсутні; команда явно повідомляє про це |

## Не перевірено автоматично

- **Live API:** реальний backend не викликався для валідації payloads; API contracts/OpenAPI schema та fixtures не було в наданих файлах.
- **Повний browser E2E:** headless Chromium блокує переходи на `http://localhost` та `file://` з `ERR_BLOCKED_BY_ADMINISTRATOR`; браузерний прогін і screenshot не зараховано. Тому фактичне візуальне проходження desktop/tablet/mobile та JS console у браузері не підтверджено.
- **Фізичні пристрої / accessibility:** screen reader, WCAG contrast audit, реальні touch targets, keyboard/focus hand-back та різні viewport потрібно перевірити вручну.
- **Tariff chart:** фактичне відображення часових зон і stacked-денного/нічного сегментування залежить від fields, які реально повертає backend.
- **Weather day/night:** фон дня й ночі залежить від timestamp сходу/заходу та timezone з payload/config; вигадані дані не підставляються.
- **Command security:** нові керувальні команди не додавалися без backend capability/permission contract; реальні дозволи не тестувалися.

## Команди відтворення

```bash
npm run build
npm run lint
npm run typecheck
npm test
npm run check
```

`npm run check` виконує production build і static checks. Для staging/production перед розгортанням треба перевірити реальні API-відповіді, адміністраторську сесію, тарифи, пристрої й responsive interaction.
