# claude-pr-reviewer

Wspólny przegląd pull requestów przez Claude na kredycie API (Agent SDK, nie Claude Code GitHub Action, bo kredyt
API nie pokrywa Claude Code). Każdy PR dostaje po otwarciu albo po „Ready for review” jeden przegląd: komentarze
w linii i krótkie podsumowanie z linią stanu (trasa, model, tury, tokeny, ewentualne obcięcie diffu).

## Jak wołać

W repozytorium, które ma dostać przegląd, plik `.github/workflows/claude-review.yml`:

```yaml
name: Claude review

on:
  pull_request:
    types: [opened, ready_for_review]
  workflow_dispatch:
    inputs:
      pr-number:
        description: Numer PR do ponownego przeglądu
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: claude-review-${{ github.event.pull_request.number || inputs.pr-number }}
  cancel-in-progress: false

jobs:
  review:
    if: github.event_name == 'workflow_dispatch' || (!github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository)
    permissions:
      contents: read
      pull-requests: write
    uses: kamilszczepanik/claude-pr-reviewer/.github/workflows/review.yml@1313a005734da1b79cea63a5001594c74efb94d7
    with:
      pr-number: ${{ inputs.pr-number }}
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
```

Sekret `AI_GATEWAY_API_KEY` jest opcjonalny: bez niego przegląd idzie tylko kredytem API (sekcja „Trasa zapasowa: bramka AI”).

Uprawnienie `pull-requests: write` dostaje tylko ta jedna praca; poziom workflowu zostaje przy `contents: read`, żeby
dopisana później praca go nie odziedziczyła. Warunek `if` pomija szkice (przegląd przychodzi przy „Ready for review”)
i PR-y z forków, które nie dostają sekretów; `concurrency` szereguje przebiegi jednego PR-a.

Model: domyślnie `claude-sonnet-5-5` (przegląd typowego PR-a około 0,15–0,20 USD). Głębszy przegląd: `model: claude-opus-5-5`
w `with:`.

## Przypięcie

Wołający przypina pełny SHA commita, nie tag: praca dostaje `ANTHROPIC_API_KEY` i token z `pull-requests: write`, więc
kod pod przypięciem nie może się zmienić bez śladu w wołającym repo. Ekosystem `github-actions` w `dependabot.yml`
wołającego podbija SHA przy nowym wydaniu.

| Wersja   | SHA                                        |
| -------- | ------------------------------------------ |
| `v1.4.0` | `1313a005734da1b79cea63a5001594c74efb94d7` |
| `v1.3.0` | `725b78491692931764120191d62166f253e470a6` |
| `v1.2.0` | `ba77aed05eb571e266c481bc044291f0ad0bfd14` |
| `v1.1.1` | `794dfb62ff44b703a756b854a39de03e369caa44` |
| `v1.1.0` | `9ad909a21e759e6ae14e607beafb2d2297c1ac1a` |

Wołający: `asystent`, `platero-ai`, `dg-cars` i to repozytorium (`.github/workflows/claude-review.yml`, przegląd własnych PR-ów).

## Kontrakt

Wejścia (`workflow_call`), wszystkie opcjonalne:

| Wejście          | Typ    | Domyślnie           | Znaczenie                                                                       |
| ---------------- | ------ | ------------------- | ------------------------------------------------------------------------------- |
| `model`          | string | `claude-sonnet-5-5` | identyfikator modelu                                                            |
| `max-comments`   | number | 15                  | najwięcej uwag w linii; reszta jest liczona w podsumowaniu                      |
| `max-diff-bytes` | number | 150000              | rozmiar diffu dla modelu, cięty na granicy pliku, najmniejsze pliki pierwsze    |
| `max-budget-usd` | number | 2                   | twardy sufit kosztu jednego przeglądu; po przekroczeniu przegląd jest pominięty |
| `pr-number`      | string | puste               | numer PR przy ręcznym ponowieniu; tylko cyfry, inaczej praca kończy się błędem  |
| `gateway-model`  | string | `anthropic/claude-sonnet-5.5` | identyfikator modelu na trasie bramki AI                              |

Sekrety: `ANTHROPIC_API_KEY` i `AI_GATEWAY_API_KEY`, oba opcjonalne. Wołający przekazuje je jawnie (nie
`secrets: inherit`). Bez obu przegląd jest pominięty z komentarzem, bez czerwonego checka. Klucz trafia wyłącznie do procesu Agent SDK (biała lista
zmiennych środowiska: klucz, `PATH`, `HOME`, locale, katalog tymczasowy, proxy); `GITHUB_TOKEN` zostaje w procesie
skryptu i nie trafia do modelu. Ani klucz, ani token, ani ich zapis base64, ani nic, co wygląda jak klucz Anthropic
albo token GitHuba, nie przechodzi do publikowanego tekstu i do logu.

Uprawnienia: `contents: read` i `pull-requests: write` na `GITHUB_TOKEN` wołającego repo. Checkout PR-a idzie
z `persist-credentials: false`.

Co recenzent robi w repozytorium: wyłącznie czyta. Model ma tylko `Read`, `Grep` i `Glob`, a hak `PreToolUse`
odrzuca każdą ścieżkę poza sprawdzonym repozytorium, także przez dowiązanie symboliczne. Skrypt publikuje najwyżej
jedną rzecz na przebieg: recenzję `event: COMMENT` (nigdy `APPROVE` ani `REQUEST_CHANGES`, więc nie blokuje i nie
zatwierdza scalenia) albo komentarz „Przegląd Claude pominięty: <powód>”, aktualizowany w miejscu przy kolejnym
pominięciu. Nie wypycha commitów, nie zmienia etykiet, nie zamyka wątków.

## Jak to działa

- `.github/workflows/review.yml` ustala PR jednym wywołaniem API (head i repo heada), sprawdza head i woła akcję
  `kamilszczepanik/claude-pr-reviewer@v<wersja>` z tego repozytorium. `GITHUB_TOKEN` wołającego repo nie czyta
  prywatnego repo recenzenta, więc kod recenzenta przychodzi jako akcja, którą runner pobiera sam. Akcja jest
  przypięta do tagu własnej wersji (`package.json`), więc workflow przypięty do `v1.x.y` uruchamia skrypty z tego
  samego wydania; pilnuje tego `test/release.test.mjs`.
- `scripts/review.mjs` pobiera diff `compare/<base>...<head>` dla tego samego `head.sha`, który sprawdził checkout,
  więc numery linii zgadzają się z plikami czytanymi przez model. Diff tnie do `max-diff-bytes` na granicy pliku,
  wypełniając limit od najmniejszych plików, żeby jeden duży plik (lockfile, fixture) nie wypchnął zmian w kodzie.
  Pominięte pliki trafiają do modelu w osobnym bloku danych, a treść recenzji zaczyna się od informacji, których
  plików przegląd nie objął. Prompt podaje modelowi limit tur, żeby przy jego końcu oddał przegląd tego, co
  przeczytał, zamiast przekroczyć limit i dać pominięcie.
- Rubryka to `CLAUDE.md` i `AGENTS.md` z commita bazowego PR-a (`git show <base>:CLAUDE.md`), więc PR nie osłabia
  reguł, które go oceniają. Gdy commita bazowego nie ma w checkoucie, rubryka pochodzi z heada, a log mówi
  „rubryka z head”.
- Agent SDK: średni wysiłek, narzędzia `Read`, `Grep`, `Glob`, tryb `dontAsk`, bez ustawień z dysku
  (`settingSources: []`, więc hooki z PR-a się nie uruchamiają), limit 20 tur, `max-budget-usd`, limit czasu
  pierwszej próby 15 minut, a ponowienie przez bramkę AI dostaje tylko czas, który zostaje ze wspólnych 18 minut,
  wynik jako JSON ze schematu. Tytuł, opis, rubryka i diff mają limity długości, a znaczniki danych w ich
  treści są neutralizowane.
- Wynik przechodzi walidację, uwagi spoza linii diffu odpadają, reszta jest cięta do `max-comments` według powagi.
  Tekst modelu przed publikacją: wycięte sekrety, `@wzmianki` rozbrojone znakiem zerowej szerokości, obrazy markdown
  i definicje odnośników usunięte, HTML zneutralizowany, odnośniki pokazane z adresem, długość ucięta (podsumowanie
  3000 znaków, uwaga 4000, całość poniżej limitu GitHuba). Publikacja w trzech krokach: recenzja z uwagami w linii,
  przy 422 recenzja z listą uwag w treści, przy kolejnym 422 samo krótkie podsumowanie.
- Pominięcie z oczekiwanego powodu nie daje czerwonego checka: wyczerpany kredyt (402) albo limit użycia, limit
  zapytań (429), odrzucony klucz (401, 403), niedostępne API Anthropic (5xx), błąd sieci, limit czasu, budżet, limit
  tur, niedostępne API GitHuba i brak sekretów. Na trasie bramki AI to samo dotyczy wyczerpanego budżetu klucza
  bramki (402), limitu zapytań bramki (429), odrzuconego klucza bramki (401, 403) i niedostępnej bramki (5xx).
  Gdy bramka była próbowana, komentarz podaje oba powody: „<powód>; bramka AI: <powód bramki>”, a bez jej klucza
  „<powód>; bramka AI nieskonfigurowana (brak sekretu AI_GATEWAY_API_KEY)”. Jest jedna linia w logu, komentarz
  o pominięciu i kod 0. Niewyjaśniona odmowa API albo bramki (każdy inny 4xx, np. 400, 404, 413, 422) daje ten sam
  komentarz, ale kod 1 i czerwony check, bo zwykle znaczy błąd w żądaniu, który trzeba naprawić. Gdy nie da się dodać nawet komentarza, zostaje druga linia w logu, a kod
  się nie zmienia. Błąd własnego kodu albo zły JSON wyniku kończy się kodem 1, a log podaje rodzaj błędu bez treści
  odpowiedzi modelu.
- Log to kilka linii na przebieg: rozmiar diffu, źródło rubryki, liczba uwag, trasa, model, tury, tokeny, koszt
  (albo „koszt nieznany”, gdy bramka nie poda kosztu), liczba odmów narzędzi. Przy pominięciu przez API linia podaje też tekst błędu API, z wyciętymi sekretami i uciętą do 300 znaków;
  do komentarza na PR-ze on nie trafia. Klucz, prompt i odpowiedzi modelu nigdy do niego nie trafiają.

## Ograniczenia i świadome wybory

- `workflow_dispatch` (ręczne ponowienie) działa dopiero, gdy plik `claude-review.yml` jest na gałęzi domyślnej
  wołającego repo. PR, który dodaje go do innej gałęzi, dostaje przegląd przy otwarciu, ale ręcznego ponowienia nie.
- Przed pierwszym PR-em w wołającym repo: tu Settings → Actions → General → Access → „Accessible from repositories
  owned by the user”. Bez tego wywołanie kończy się przy starcie workflowu błędem „workflow was not found”
  (czerwony check, bez komentarza), bo skrypt nawet nie rusza.
- `ready_for_review` uruchamia przegląd przy każdym przejściu ze szkicu do gotowego, a `concurrency` tylko
  szereguje przebiegi, nie usuwa powtórzeń: każde przełączenie to nowy płatny przegląd. Sufitem jest
  `max-budget-usd` na przebieg i limit wydatków workspace'u.
- Hak granicy repozytorium warto potwierdzić na żywo: pierwszy przegląd testowy pokazuje w logu „odmowy narzędzi 0”
  na zwykłym PR-ze.

## Ponowne uruchomienie ręczne

Actions → „Claude review” → Run workflow → numer PR. Albo:

```sh
gh workflow run claude-review.yml --repo <owner>/<repo> -f pr-number=<n>
```

Każde uruchomienie to nowy przegląd i nowy koszt.

## Kredyt API

Płaci kredyt API z org „Kamil's Individual Org”, workspace `ci-review` z własnym limitem wydatków: 200 USD
miesięcznie w planie Max, odnawia się 26. dnia miesiąca, niewykorzystany przepada, a po wyczerpaniu żądania stają do
odnowienia (twardy stop, bez karty i bez auto-reload). Przy wyczerpanym kredycie przegląd idzie bramką AI, gdy jest
jej klucz; bez klucza zostaje komentarz „pominięty” zamiast czerwonego checka.

## Trasa zapasowa: bramka AI

Gdy trasa kredytu API odpowie wyczerpanym kredytem (402, tekst o kredycie albo rozliczeniu) albo wyczerpanym limitem
użycia (`usage limit` przy 400 lub 429), recenzent raz ponawia cały przegląd od zera przez Vercel AI Gateway. Przy
401, 403, zwykłym 429, 5xx, błędzie sieci, limicie czasu, budżecie i limicie tur ponowienia nie ma. Bez
`ANTHROPIC_API_KEY`, a z kluczem bramki, przegląd idzie od razu bramką. Bramka nie ma trasy dalej.

Na trasie bramki proces Agent SDK dostaje `ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh/claude-code` (bez `/v1`),
`ANTHROPIC_AUTH_TOKEN` z kluczem bramki i pusty `ANTHROPIC_API_KEY`; trasa kredytu API tych zmiennych nie dostaje.
Model wybiera wejście `gateway-model`, domyślnie `anthropic/claude-sonnet-5.5`. Linia stanu recenzji mówi wtedy
„trasa: bramka AI”, a log zapisuje powód przełączenia („Trasa kredyt API: <powód>; ponawiam przez bramkę AI”).

Koszt przeglądu bramką to około 0,05–0,15 USD; `max-budget-usd` i limit tur obowiązują jak na kredycie API. Twardym
limitem jest budżet klucza bramki (20 USD miesięcznie), a jego wyczerpanie (402) daje pominięcie bez czerwonego
checka. Obrót klucza: nowy klucz w panelu AI Gateway, podmiana sekretu w każdym repozytorium
(`gh secret set AI_GATEWAY_API_KEY --repo <owner>/<repo>`), dopiero potem wyłączenie starego.

Retencja: na tej trasie diff idzie przez Vercel do Anthropic bez przypięcia regionu i bez zerowej retencji, na co się
godzimy, bo kod nie niesie danych osobowych.

## Klucz API

Sekret `ANTHROPIC_API_KEY` w każdym wołającym repozytorium ustawia właściciel ręcznie. Klucz tworzymy wewnątrz
workspace `ci-review` i sprawdzamy żądaniem na jeden token, bo prefiks klucza nie zdradza, czy ma workspace. Obrót:
nowy klucz w Console, podmiana sekretu w każdym repozytorium (`gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo>`),
ręczne ponowienie przeglądu na dowolnym PR-ze, dopiero potem wyłączenie starego klucza.

## Tagi i wydanie

`v1` to tag ruchomy w obrębie wersji głównej, a każde wydanie dostaje stały tag `v1.x.y`. Wołające repozytoria
przypinają SHA (sekcja „Przypięcie”), więc nowe wydanie dociera do nich PR-em Dependabota albo ręczną zmianą SHA. Zmiana niezgodna wstecz (wejścia, sekrety, uprawnienia) to
`v2`. Wydanie:

1. Podnieś `version` w `package.json` (i `package-lock.json`) oraz tag akcji w `.github/workflows/review.yml`
   (`uses: kamilszczepanik/claude-pr-reviewer@v1.x.y`); `npm test` pilnuje, że są równe.
2. Commit, potem utwórz i wyślij na origin stały tag `v1.x.y`, a dopiero po nim przesuń `v1` na ten sam commit
   (`git tag -f v1` i wysłanie z `-f`). Kolejność ma znaczenie: `v1` przesunięty przed stałym tagiem wskazywałby
   akcję pod tagiem, którego jeszcze nie ma. To jedyny dopuszczony force-push w tym repozytorium: `v1` jest tagiem
   ruchomym z definicji, a stałe tagi `v1.x.y` nigdy się nie przesuwają.
3. Dopisz wiersz do tabeli w „Przypięcie”.
4. Przegląd tego repozytorium (`claude-review.yml`) przypina SHA poprzedniego wydania, bo commit wydania nie może
   zawierać własnego SHA; podbij go w tym samym PR-ze co wiersz tabeli z kroku 3.

## Rozwój

Node 22, czysty ESM, zależności przypięte do dokładnych wersji. `npm test` uruchamia `node --test` na czystej logice:
mapowanie linii diffu, obcinanie, walidacja wyniku, wybór komunikatu przy błędzie API, sanityzacja i limity długości,
publikacja z cofaniem po 422, wyjście 0 przy pominięciu, granica repozytorium, rubryka z bazy, zgodność wersji akcji,
wybór trasy i ponowienie przez bramkę, stronicowanie komentarzy.
