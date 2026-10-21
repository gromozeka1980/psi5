# Russian translation — style and technical rules (Psi 5 Trading Company, modern remake)

Scope: only the modern remake (`web/src/i18n/*.json`, used by the new UI on top of `web/src/engine/`).
The 1:1 classic port (`web/src/psi5/*`, `web/src/sel.js`, `web/src/rt.js`) stays English, with the original CGA font.
Terms and names: [GLOSSARY.md](GLOSSARY.md). Check: `node tools/i18n_check.mjs` (must print `OK`, warnings reviewed).

Conventions follow the user's earlier remakes (Alter Ego `Aego/docs/i18n`, Siboot `TB/web/docs/i18n`): one word per
concept everywhere, names transliterated (never russified), the original's setting and realities kept
(dollars, parsecs), «ёлочки», long dash, ё always.

## 1. Files and keys
- `web/src/i18n/en.json` — source, generated from `docs/modern/assets/text.json` (original text, CR line breaks
  joined, runs of spaces collapsed, nothing else changed: typos and Aymu's accent are kept verbatim).
  `ru.json` — the same keys. Keys starting with `_` are metadata (`_about`, `_msgSlots`, `_limits`), not strings.
- Key scheme:
  | prefix | what |
  |---|---|
  | `ui.*`, `menu.*`, `ack.*` | start/briefing/pause, menu bars, the acknowledge (message) menu |
  | `dept.<d>.name/short/abbr/letter/role` | department names: panel/SEL title, menu label (`Weap.`), upper prompt prefix (`WEAP.`), message lamp letter, role noun |
  | `weapons.* scanning.* navigation.* engineering.* repair.*` | department prompts and empty-list notices |
  | `weapon.*`, `fire.*`, `contact.*`, `nav.*`, `speed.*`, `course.*`, `power.*`, `dev.*`, `engPanel.*`, `system.*` | words inside reports: weapon types, fire status, contact flags, nav state, speed labels, 5 courses, power classes, device states, the 26 ship systems |
  | `panel.*`, `col.*` | report titles and column headers |
  | `alert.*`, `end.*`, `quit.*`, `arrival.*`, `invoice.*`, `money.*` | alarms, mission end, quit menu, arrival, Mission Invoice |
  | `sel.*` | course and crew selection (SEL.EXE) |
  | `mission.<0..3>.destination/cargo`, `place.*`, `ship.<class>.one/many` | 4 routes, place names, 23 alien ship classes |
  | `crew.<id>.name` | name in the candidate list |
  | `resume.<id>.name/age/species/qualifications/education/experience/strengths/weakness` | the 30 personnel files |
  | `msg.<id>.<slot>` | crew dialogue. `<id>` = crew file name (`boris`, `q6d`, `t3` …). `<slot>` is the same for every officer of a department; the order = message index in the crew file = `_msgSlots.<department>[index]` (the engine maps a message id `dept*0x200 + index*2` to the key with it). `sign` = the signature line under each message |
- Placeholders `{name}` are filled by the game. Keep every one, same spelling; order may change.
  Used: `{dept}` (a `dept.*.abbr` value), `{n}`, `{m}` (money, millions), `{pct}`, `{sec}`, `{eta}`, `{course}`,
  `{speed}`, `{destination}`, `{shots}`, `{weapon}`, `{target}`, `{pri}`, `{device}`.
- Numbers with a counted noun: avoid Russian plural agreement by putting the number after a colon or using a
  form that fits every number: «рободроидов: {n}», «{n} парсек», «{m} млн $».

## 2. Lengths
The original was a 40-column CGA screen; `_limits` in `en.json` keeps the original width of every fixed-width string.
The new UI is not bound by it, but: menu items ≤ 10 characters, table headers/cells ≤ the original width + a few
characters (use the glossary abbreviations), prompts on one line (≤ ~40). Crew messages and resumes are free text
(the original wrapped them at 38/27 columns); keep them about as long as the English (+20 % is fine).
`node tools/i18n_check.mjs` prints the length report.

## 3. Address and register
| who → whom | form | note |
|---|---|---|
| officer → captain (every crew message) | **вы** | ship's protocol. Rudeness/familiarity is expressed by vocabulary, not by «ты». Past tense of «вы» is plural («вы просили») — handy: the captain's gender is unknown, so never use singular gendered forms for the captain |
| "sir" | **«сэр»** | kept as in the original (space-opera flavour, different from "Captain" = «капитан», which some officers use instead of "sir") |
| "Captain" (title in the message window, direct address) | «Капитан» / «капитан» | |
| officer → the whole crew («Hang on, space cadets!») | plural | |
| Admiral Lorenzen (briefing), the orders text in SEL → captain | **вы**, official | |
| officer about another officer | third person, **gender-neutral**: the other department's officer can be male or female (Jaru, Tegra, Nargo, Sheema are women). Make the role noun the object or use a noun phrase: «Штурмана больше нет», «Мы потеряли инженера», «Инженер мёртв» is fine (adjective agrees with the masculine role noun), but avoid «он/его» and gendered past tense («штурман погиб» → «штурмана убило», «у штурмана кончился воздух») | |

## 4. Officers: gender and voice (keep each voice consistent across all their messages and resume)
The officer's own gender decides their past tense («я сделал/сделала»). Droids are masculine (дроид).
Robodroids are «он».

| id | officer | gender | voice |
|---|---|---|---|
| boris | Борис Тарков, джаргонианец, 47 | m | war-lover, crude and barking: short exclamations, insults («придурки», «шавки»), «Обожаю запах плавленого металла!» |
| q6d | Q6-D, ваккдроид, 12 | m | protocol droid: «Докладываю: …», stiff canned phrases, bureaucratic; sly «(Хе-хе-хе.)» |
| yeela | Йила, глорк, 270 | m | warm, emotional, polite («сэр»), likes wordplay — keep the pun in `blasterDestroyed` |
| alzott | Эл «Яблочко» Зотт, олерио, 32 | m | professional, clipped military report («Довожу до сведения…») |
| skulard | Скулард Праблык, балнарвиец, 40 | m | measured, a bit bookish and philosophical, complete sentences |
| grolo | Гроло, сколлиец, 17 | m | teenager, always hungry, cheerful slang («Полный улёт!»), furry («всеми четырьмя лапами») |
| jaru | Джару Лагон, палагононка, 127 | **f** | crisp and competent; sarcastic about men («Мужчины, ха!») |
| phyzo | Физо Тинкс, драгулас, 25 | m | terse, slangy, grim jokes, wants revenge |
| blustan | Бластан, рептилиус, 112 | m | gossipy, chatty, philosophical; «О звёзды!»; pet skork, college days |
| nargo | Нарго Клоя, лайтонка, 16 | **f** | shy, quiet, telepathic: «я чувствую…», «мне являются образы…» |
| churglik | Чурглик, флипогиец, 340 | m | nervous, flustered, simple sentences, sniffs («Шмыг-шмыг…») |
| mike | Майк с Моргона, хиролианец, 24 | m | family man and joker, earthy humour («солнечные пони», «знаки зодиака») |
| klg | KLG-7A, ваккдроид, 6 | m | joking droid: «Держитесь, космические кадеты!», jokes about cheap Rigelian parts |
| tegra | Тегра Клоя, лайтонка, 26 | **f** | new-age, karma and intuition, sassy slang («астрозадницы») |
| nik | Ник Рельпо, земболианец, 30 | m | hot-headed, rude-ish («эта свинья», «эта жестянка»), quick to panic |
| bronx | Бронксааг, вораксианец, 72 | m | anxious, apologetic, polite («пожалуйста»), «Звёзды мои!» |
| aymu | мистер Айму Скамп, джамико, 30 | m | **heavy accent** (see §5), bureaucratically polite («при первой фосмошности. Спасипо.») |
| yenx | Йенкс, джагонец, 210 | m | calm, plain, polite, a little dreamy; full sentences |
| craven | Крейвен Майклс, лоллианец, 33 | m | easy-going but panics about his life support; «Звёздная пыль!»; the Cravenlator is his namesake |
| wilfo | Уилфо, бодианец, 400 | m | polite, excitable, telepathic («я чувствую…»), fatalistic «Ну и ладно!» |
| tony | Тони (Энтони Фризина), графокс, 26 | m | worrier with sarcastic humour, «Эй, ребята», doesn't know what the Cravenlator is |
| fligrnk | Флигронк Плгзур, цирио, 350 | m | serious, terse, angry at incompetence |
| sheema | Шима Сампу, титанианка, 22 | **f** | deliberate, formal, measured («Лично меня беспокоит…») |
| vx4 | VX-4, ваккдроид | m | machine diagnostics: «Обнаружено…», «Анализ завершён», «миллисек», broken words when dying |
| anxy | Энкси, токлар, 43 | m | friendly, reliable veteran, kind |
| t3 | T3XR9 «Ти-три», ваккдроид, 7 | m | precise droid, sound effects («Клек!», «ЗУРК…»), sentimental about robodroids |
| vofgank | Вольфганк «Хэнк», тиролец, 37 | m | loner, matter-of-fact, dry («космические олухи») |
| ryblo | Рибло Фларн, альфианец, 29 | m | lazy, cynical, crude («астроуроды»), smuggler |
| bru | Бру Мармо, лиапионец, 31 | m | bossy, boastful, «Мне надо больше платить!» |
| swigltz | Свиглиц, альтрос, 52 | m | eager to please, servile («надеюсь, я хорошо справился, сэр»), dark pun «Покойся с миром… или по частям» |

## 5. Aymu's accent
English: a thick Central-European accent ("Ve iz startink evasive manuvrink"). Russian: a «German» accent —
devoice voiced consonants (б→п, в→ф, г→к, д→т, з→с, ж→ш) in about every second word, «ошень», «пашалста»,
«ферк» for «работает» is too much; keep every sentence readable at first glance. Example:
«Ми не мошем менять курс налефо: прафый ретротфигатель сломан.»

## 6. Language and typography
- Plain modern Russian, sci-fi radio chatter: short sentences, exclamations as in the original, CAPS emphasis kept
  («НЕМЕДЛЕННО!»). Humour and insults are translated, not softened. Typos of the original are fixed silently
  (except Aymu); the original's misspelled menu items ("manuevering") are translated normally.
- Quotes «…»; dash « — » with spaces; ellipsis `...` (three dots; the original's "......" → "..."); ё always.
- No line breaks inside strings, one space between sentences.
- Menu items: infinitive or noun, capitalised; prompts in the status line: infinitive («Отменить приказ на огонь»).
- Report words that were lower case in the original stay lower case (`fire.*`, `nav.*`, `scanning.nothing`).
- Latin letters only in model designations listed in the glossary (Q6-D, GX75, XTN …).
- Russian words and names only; no English left except those designations.
