# Підсумок реалізації

**Версія UI/Worker:** 4.0.0. **Дата:** 27 жовтня 2026 року.

## Додаткові виправлення під час валідації 27.10.2026

- Синхронізація climate tooltip тепер зіставляє серії за нормалізованим timestamp, а не за текстом відформатованої дати/часу.
- Запити історії з AbortSignal не блокуються старим pending Promise при швидкому поверненні до раніше вибраного періоду.
- Вибір chip кімнати керує фокусом series і може бути скасований повторним натисканням.
- Виправлено mobile aspect ratio та opacity SVG заливки; додано 8 статичних acceptance/regression тестів за ТЗ.

Статус відповідності критеріям і нерозв’язані API-залежності: [`spec-compliance.md`](spec-compliance.md). Ці зміни не означають, що live API, accessibility audit або browser E2E були виконані.

## Виконано

- Винесено джерело HTML/CSS/JS в `src/index.html`; Worker `index.js` збирається автоматично з джерела.
- Збережено поточний API URL, `req()` helper, доступ за bearer token до admin API, timeline та наявні domain state/API functions.
- Додано direct routes і підтримку deep links для home, climate, energy, weather, devices, timeline, admin; застосунок знову доступний при прямому відкритті URL.
- Перероблено головну в оперативний центр: score лише з backend, пояснення причини, два максимум показані events із deduplication, climate/energy/weather snapshots, 7-денний forecast strip, counts пристроїв і максимум три рекомендації.
- Побудовано повний інтерактивний SVG-план п’яти приміщень: `room-kids`, `room-hallway`, `room-bedroom`, `room-kitchen`, `room-bathroom`; додано режими заливки температури/вологості/комфорту/без заливки, вибір мишкою та клавіатурою, fullscreen, масштаб і переміщення через кнопки.
- Додано окремі температурний і вологісний графіки з автоматичним діапазоном осі, комфортними bands, `spanGaps:false`, спільним tooltip і navigator.
- Додано energy chart modes power/energy/cost/voltage, stacked day/night series якщо backend повертає окремі tariff values, часові зони денного/нічного тарифу лише за доступної конфігурації, actual/budget/forecast розділені за наявності полів API.
- Додано weather modes temperature/precipitation/humidity/wind, 0–100 шкалу опадів, hourly rail, current details, sunrise/sunset detail, forecast range bars і day/night shading за наявності часових даних сходу/заходу.
- Додано сторінку пристроїв, status badges та фільтри. Вона використовує `/devices/status` і не створює фіктивні записи.
- Уніфіковано CSS variables, стилі карток/статусів, keyboard focus, reduced motion, responsive layouts і toolbar controls.
- Додано source-level build, static lint, Worker smoke tests та обов’язкову документацію.

## Routes

- `/`, `/index.html`, `/home`
- `/climate?room=<room-id>`
- `/energy?metric=power|energy|cost|voltage&period=day|week|month`
- `/weather?horizon=48h&timestamp=<timestamp>`
- `/devices`, `/devices?status=attention`, `/devices/<device-id>`
- `/timeline`, `/admin`, `/about`

`/about` зараз віддає той самий dashboard; версія зазначена в sidebar footer.

## Нові npm залежності

Немає. Chart.js 4.5.1 CDN збережено, як у вихідному проєкті. Це навмисно: даний застосунок не є React-проєктом і його перенесення на новий фреймворк не було необхідним для редизайну.

## Що залишилося обмеженням

- Не підтверджено backend API контрактом, що він повертає tariff schedules/rates, day/night split кожного інтервалу, monthly budget/forecast, weather timezone та sunrise/sunset для кожного дня.
- Не всі детальні status enums (archived/disabled/no-history/not-configured/integration-error) гарантовано повертає backend; UI показує їх, коли відповідні дані є.
- Графічна модель квартири є схематичною; початкове креслення з точними геометричними розмірами не входило до наданих файлів як окремий кресленик.
- Live integration і фізичне browser/mobile E2E тестування не виконувались; результати статичних і Worker тестів описані окремо.

## Уточнення щодо завершеності

Це production-oriented редизайн існуючого Worker, але не повний перенос на окремі модулі/компоненти React. Зберігається vanilla JS і частина legacy-глобальних функцій в `core.js`; їх повне видалення відкладено, щоб не пошкодити наявні admin/auth/timeline flows без browser E2E. Перелік залежних від backend полів наведено в `docs/api-gaps.md`. Автоматичні тести покривають побудову Worker і базові HTTP/deep-link контракти, але не замінюють перевірку UI у браузері з live payloads.
