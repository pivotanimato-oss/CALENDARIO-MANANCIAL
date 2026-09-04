# Calendário Manancial

A agenda da igreja, publicada em
<https://pivotanimato-oss.github.io/CALENDARIO-MANANCIAL/>.

## Onde é que a agenda vive

Em `dados/agenda.json`, e mais lado nenhum.

- A **página** (`index.html`) lê esse ficheiro quando abre.
- Os **calendários** (`calendars/*.ics`) saem desse ficheiro:
  `node scripts/gerar.mjs`.

Nunca editar um `.ics` à mão — a próxima geração apaga a alteração. Foi
exactamente isso que aconteceu antes: um commit mudou as horas nos `.ics`
sem mexer na página, e durante meses o site mostrava "sem hora" em cinco
ministérios que na agenda das pessoas apareciam às 19h.

## Duas regras que não se quebram

**1. O endereço não muda.** Quem carregou em "Google Agenda" ficou
*assinado* a `webcal://pivotanimato-oss.github.io/CALENDARIO-MANANCIAL/calendars/<grupo>.ics`.
Mudar de alojamento (Vercel, domínio próprio), renomear um ficheiro ou
mudar o `id` de um grupo deixa essa gente presa ao endereço antigo, que
congela para sempre — e não há forma de os avisar. O GitHub Pages fica
onde está.

**2. O UID de cada evento não muda.** É o UID que diz ao Google "este é o
mesmo evento, só mudou a hora" em vez de "apaga aquele e cria este". Os
eventos que já foram publicados guardam o UID original no campo `uid` do
JSON; os novos ganham um UID derivado de grupo + data + título, que
sobrevive a inserções no meio da lista.

## Quem escreve isto

O robô do WhatsApp (`whatsapp-secretaria`, `src/ministry/agendaSite.js`)
lê a agenda que a Prª. Cleuziney manda nos grupos, actualiza o
`dados/agenda.json`, corre o gerador e faz push. A partir daí é o GitHub
Pages que publica e o Google que relê.

O Google relê os calendários assinados ao ritmo dele — normalmente
algumas horas, às vezes um dia. Não há forma de o obrigar a ir mais
depressa. Quem usou o botão "Calendário nativo" tirou uma **cópia** e não
recebe actualização nenhuma; tem de carregar outra vez.
