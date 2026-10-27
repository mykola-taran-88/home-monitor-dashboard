# API gaps та потрібні backend поля

Цей перелік сформовано з поточного frontend-коду й нових adapters. Окремого OpenAPI/API contract або backend-коду у вкладеннях не було, тому поля нижче є фактичними frontend references та рекомендаціями для узгодження, а не заявою про backend schema.

## Endpoints, які використовує чинний UI

| Endpoint | Використання |
|---|---|
| `GET /control/overview` | Score factors, current power/weather, room summary, status/settings якщо передані |
| `GET /dashboard` | Alerts, recommendations, weather current/hourly/daily, energy statistics |
| `GET /home-score` | Home Score при наявності backend-відповіді |
| `GET /devices/status` | Список пристроїв, online/status, measurements, age/last seen |
| `GET /charts/power?hours=…` | Power history |
| `GET /charts/climate?hours=…` | Room history: labels та datasets для temperature/humidity |
| `GET /charts/energy?hours=…` | Energy history fallback |
| `GET /charts/energy/range?period=…&from=…&to=…` | Aggregated energy periods |
| `GET /analytics/tariff-range?month=…` або `?from=…&to=…` | Тарифні totals/history |
| `GET /timeline?limit=100` | Історія подій |
| Auth/admin: `/auth/login`, `/auth/logout`, `/auth/session`, `/admin/channels`, `/admin/categories`, `/admin/settings`, `/admin/modes`, `/admin/preferences`, `/admin/channel-category`, `/admin/channels/:id`, `/admin/test-notification`, `/admin/categories/:key`, `/admin/modes/:key`, `/admin/audit` | Збережені адміністративні функції |

## Дані, яких може бракувати

### Клімат

- Стабільний `roomId` та явний mapping `deviceId` → `roomId` для всіх кімнат. SVG IDs: `room-kids`, `room-hallway`, `room-bedroom`, `room-kitchen`, `room-bathroom`.
- Для кожної точки: timestamp ISO 8601 з timezone/offset, temperature, humidity, source, quality та status. Розриви повинні лишатися `null`, а не інтерполюватися.
- Комфортні межі (температура/вологість) і stale multiplier як config/API settings, а не заховані константи UI.
- Якщо кухня/ванна не мають датчиків, API має віддавати відсутність sensor mapping; UI відображає «Немає датчика», не «Офлайн».

### Енергія

- Тарифна конфігурація: `day_start`, `night_start`, day/night rates, timezone та effective dates. UI не вигадує тарифні години/ціни.
- Для stacked-series за кожен aggregation interval: `day_kwh`, `night_kwh`, `day_cost`, `night_cost`; якщо interval перетинає межу тарифу, backend має або повертати split-сегменти, або дати raw intervals для розбиття.
- Network metrics: `voltage`/`voltage_v`, `frequency`/`frequency_hz`, `grid_status`/`network_status`.
- Peak: value та timestamp (`peak_power`, `peak_time`/`peak_at`).
- Явні `actual`, `budget`, `forecast` та `estimated_savings` поля з quality/period; поточні frontend reference names: `budget`, `projected_cost`/`forecast_cost`, а статистика actual — `statistics.today/month`.
- Щоб будувати денні/нічні фони на power chart, dashboard або settings API мають надати тарифи та часові вікна. Коли їх немає, UI явно повідомляє, що вікна не надані.

### Погода

- `timezone` місця прогнозу у weather payload або location config.
- `current`: `temperature`, `feels_like`, `humidity`, `wind_speed`, `wind_gusts`/`wind_gust`, `wind_direction`, `pressure`, `sunrise`, `sunset`, `weather_icon`, `weather_description`.
- `hourly_3h` або `hourly`: timestamp, temperature, precipitation probability, humidity, wind speed/gusts/direction; нульова ймовірність опадів має бути саме числовим `0`, невідоме значення — `null`.
- `daily`: `date`, `temp_min`, `temp_max`, precipitation, wind, sunrise/sunset й weather icon.
- Для погодних попереджень потрібен окремий список alerts або явні warning поля. UI не створює попереджень без API/правила.
- Якщо timezone не передано, frontend використовує Europe/Kyiv як fallback. Для локації поза цим поясом backend має передавати timezone.

### Стан дому / пристрої / рекомендації

- Score: `scores.overall`, `scores.comfort`, `scores.energy`, `scores.weather` та `status`; клієнт не розраховує ваги score.
- Події: `id`, `entity_id`, `source`, `severity`, `timestamp/created_at`, `status`, `deep_link`; ці дані полегшують стабільну deduplication.
- Device detail API відсутній у наданих reference endpoints. `/devices/:id` зараз вибирає запис з `/devices/status`; для повного detail view можна додати `GET /devices/:id`.
- Для capabilities/commands потрібно явне поле capabilities та permission response; критичні команди не додано в цей редизайн, а кнопки керування не створюються без підтверджених backend можливостей.
- Для stale/offline/disabled/archived/no-history/not-configured/integration-error потрібні нормалізовані status enum та timestamps. Якщо API не повертає їх, фронтенд не може достовірно відрізнити всі ці стани.
