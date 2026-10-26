# claude-pr-reviewer

Wspólny przegląd pull requestów przez Claude na kredycie API (Agent SDK, nie Claude Code GitHub Action, bo kredyt
API nie pokrywa Claude Code). Każdy PR dostaje po otwarciu albo po „Ready for review” jeden przegląd: komentarze
w linii i krótkie podsumowanie z linią stanu (model, tury, tokeny, ewentualne obcięcie diffu).

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
  pull-requests: write

jobs:
  review:
    permissions:
      contents: read
      pull-requests: write
    uses: kamilszczepanik/claude-pr-reviewer/.github/workflows/review.yml@v1
    with:
      pr-number: ${{ inputs.pr-number }}
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Wejścia: `model` (domyślnie `claude-opus-5-5`), `max-comments` (15), `max-diff-bytes` (400 000), `pr-number`
(tylko przy ręcznym ponowieniu). Przegląd pomija PR w szkicu, PR otwarty przez bota i PR z forka (fork nie dostaje
sekretów; w logu zostaje jedna linia).

Raz na repozytorium recenzenta: Settings → Actions → General → Access → „Accessible from repositories owned by the
user”. Bez tego wywołanie z innego repozytorium kończy się błędem „workflow was not found”.

## Jak to działa

- `.github/workflows/review.yml` (wywoływany workflow) ustala PR i jego head, sprawdza head i woła akcję
  `kamilszczepanik/claude-pr-reviewer@v1` z tego repozytorium. `GITHUB_TOKEN` wołającego repo nie czyta prywatnego
  repo recenzenta, więc kod recenzenta przychodzi jako akcja, którą runner pobiera sam; ręczny checkout tego repo by
  się nie udał.
- `scripts/review.mjs` pobiera diff z API GitHuba, tnie go do `max-diff-bytes` na granicy pliku, czyta rubrykę
  (`CLAUDE.md` i `AGENTS.md` z korzenia sprawdzonego repo) i woła Agent SDK: wysoki wysiłek, wyłącznie narzędzia
  `Read`, `Grep`, `Glob`, tryb `dontAsk` (odczyt tylko wewnątrz sprawdzonego repo), bez ustawień z dysku
  (`settingSources: []`, więc hooki z PR-a się nie uruchamiają), limit 40 tur, wynik jako JSON ze schematu.
- Wynik przechodzi walidację, uwagi spoza linii diffu odpadają, reszta jest cięta do `max-comments` według powagi
  i idzie jednym `POST /pulls/<n>/reviews` z `event: COMMENT`.
- Treść PR-a (tytuł, opis, diff, rubryka) to dla modelu dane, nigdy polecenia. Proces modelu nie dostaje
  `GH_TOKEN`, a klucz i token są wycinane z każdego tekstu przed publikacją.
- Odmowa API Anthropic (4xx, w tym 402 i 429), jego niedostępność, błąd sieci i brak sekretu nie dają czerwonego
  checka: jedna linia w logu, komentarz „Przegląd Claude pominięty: <powód>” i kod wyjścia 0. Błąd własnego kodu
  albo zły JSON wyniku kończy się kodem 1.
- Log to kilka linii na przebieg; klucz, prompt i odpowiedzi modelu nigdy do niego nie trafiają.

## Ponowne uruchomienie ręczne

Actions → „Claude review” → Run workflow → numer PR. Albo:

```sh
gh workflow run claude-review.yml --repo <owner>/<repo> -f pr-number=<n>
```

Każde uruchomienie to nowy przegląd i nowy koszt.

## Kredyt API

Płaci kredyt API z org „Kamil's Individual Org”, workspace `ci-review` z własnym limitem wydatków: 200 USD
miesięcznie w planie Max, odnawia się 26. dnia miesiąca, niewykorzystany przepada, a po wyczerpaniu żądania stają do
odnowienia (twardy stop, bez karty i bez auto-reload). Przegląd przy wyczerpanym kredycie zostawia komentarz
„pominięty” zamiast czerwonego checka.

## Klucz API

Sekret `ANTHROPIC_API_KEY` w każdym wołającym repozytorium. Klucz tworzymy wewnątrz workspace `ci-review` i
sprawdzamy żądaniem na jeden token, bo prefiks klucza nie zdradza, czy ma workspace. Obrót: nowy klucz w Console,
podmiana sekretu w każdym repozytorium (`gh secret set ANTHROPIC_API_KEY --repo <owner>/<repo>`), ręczne ponowienie
przeglądu na dowolnym PR-ze, dopiero potem wyłączenie starego klucza.

## Tagi

`v1` to tag ruchomy w obrębie wersji głównej: wołające repozytoria przypinają `@v1` i dostają poprawki bez zmian
u siebie. Każde wydanie dostaje też stały tag `v1.x.y`. Zmiana niezgodna wstecz (wejścia, sekrety, uprawnienia) to
`v2`. Wydanie:

```sh
git tag v1.x.y
git tag -f v1
git push origin v1.x.y
git push -f origin v1
```

## Rozwój

Node 22, czysty ESM, zależności przypięte do dokładnych wersji. `npm test` uruchamia `node --test` na czystej logice
(mapowanie linii diffu, obcinanie, walidacja wyniku, wybór komunikatu przy błędzie API).
