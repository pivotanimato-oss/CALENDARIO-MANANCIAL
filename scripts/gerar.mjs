/**
 * gerar.mjs — lê `dados/agenda.json` e escreve `calendars/*.ics`.
 *
 * A agenda passou a ter UMA fonte só: `dados/agenda.json`. A página
 * (index.html) lê esse ficheiro em runtime; os .ics saem daqui. Nunca
 * editar um .ics à mão — é sobrescrito na próxima geração.
 *
 *     node scripts/gerar.mjs
 *
 * Porque é que isto importa: quem carregou em "Google Agenda" na página
 * ficou ASSINADO ao endereço do .ics (webcal://…/calendars/<id>.ics). O
 * Google relê esse ficheiro de tempos a tempos sozinho — por isso mudar o
 * .ics aqui é o que faz a agenda das pessoas mudar. Duas consequências:
 *
 *   1. O endereço não pode mudar. Trocar de alojamento (Vercel, domínio
 *      próprio, renomear um ficheiro) deixa toda a gente presa ao endereço
 *      antigo, que congela para sempre. O GitHub Pages fica onde está.
 *
 *   2. O UID de cada evento tem de ser ESTÁVEL. É o UID que diz ao Google
 *      "este é o mesmo evento de antes, só mudou a hora" em vez de "apaga
 *      aquele e cria este". Antes o UID era a POSIÇÃO no array
 *      (`outros-0-…`, `outros-1-…`), portanto bastava inserir uma data no
 *      meio para todos os UIDs seguintes mudarem e a agenda de toda a
 *      gente ser apagada e recriada. Agora o UID vem da data + título, que
 *      não se mexem quando se insere algo à frente.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FICHEIRO_AGENDA = path.join(RAIZ, 'dados', 'agenda.json');
const PASTA_CALENDARIOS = path.join(RAIZ, 'calendars');

const DOMINIO_UID = 'manancial-calendario';

// Bloco de fuso horário — copiado tal e qual do que já estava publicado,
// para não mexer em nada do lado de quem já assinou.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Lisbon',
  'X-LIC-LOCATION:Europe/Lisbon',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:WEST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:WET',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Texto dentro de um campo iCalendar: barra, ponto-e-vírgula, vírgula e quebras. */
function escapar(texto) {
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Dobra a linha aos 75 OCTETOS (RFC 5545), não aos 75 caracteres — a
 * diferença conta porque "Diáconos", "Mutirão" e companhia ocupam dois
 * bytes por acento. Dobrar a contar caracteres passa do limite e há
 * clientes que cortam a linha a meio de uma letra.
 */
function dobrar(linha) {
  const bytes = Buffer.from(linha, 'utf8');
  if (bytes.length <= 75) return linha;

  const pedacos = [];
  let inicio = 0;
  let limite = 75;
  while (inicio < bytes.length) {
    let fim = Math.min(inicio + limite, bytes.length);
    // Nunca cortar no meio de um caractere multi-byte: recua enquanto o
    // byte seguinte for uma continuação (10xxxxxx).
    while (fim > inicio && fim < bytes.length && (bytes[fim] & 0xc0) === 0x80) fim--;
    pedacos.push(bytes.slice(inicio, fim).toString('utf8'));
    inicio = fim;
    limite = 74; // as linhas seguintes levam um espaço à frente
  }
  return pedacos.join('\r\n ');
}

/** "20260822" -> Date em UTC (a data é só uma etiqueta, não um instante). */
function paraData(aaaammdd) {
  return new Date(Date.UTC(
    Number(aaaammdd.slice(0, 4)),
    Number(aaaammdd.slice(4, 6)) - 1,
    Number(aaaammdd.slice(6, 8)),
  ));
}

function paraTexto(data) {
  return data.toISOString().slice(0, 10).replace(/-/g, '');
}

function diaSeguinte(aaaammdd) {
  const d = paraData(aaaammdd);
  d.setUTCDate(d.getUTCDate() + 1);
  return paraTexto(d);
}

/**
 * UID estável: grupo + data + impressão digital do título. Sobrevive a
 * inserções, reordenações e a mudanças de hora (mudar a hora do mesmo
 * evento passa a ser uma ACTUALIZAÇÃO na agenda das pessoas, não um
 * evento novo). Mudar o título conta como evento diferente — e é: um
 * "Churrasco" que passa a "Vigília" no mesmo dia é outra coisa.
 */
export function uidDoEvento(grupoId, evento) {
  // Evento que JÁ foi publicado guarda o UID com que saiu da primeira vez
  // (ver `uid` em dados/agenda.json). É essa a identidade que a agenda das
  // pessoas conhece — trocá-la faria o Google apagar o evento e criar
  // outro. Só quem ainda não tem UID nenhum recebe o esquema abaixo.
  if (evento.uid) return evento.uid;

  const chave = String(evento.titulo).trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const digito = crypto.createHash('sha1').update(`${grupoId}|${evento.data}|${chave}`).digest('hex').slice(0, 10);
  return `${grupoId}-${evento.data}-${digito}@${DOMINIO_UID}`;
}

/** "2000" + 2 -> "2200". Não passa da meia-noite: fica em 23:59. */
function somarHoras(hhmm, horas) {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4)) + horas * 60;
  if (total >= 24 * 60) return '2359';
  return String(Math.floor(total / 60)).padStart(2, '0') + String(total % 60).padStart(2, '0');
}

function blocoEvento(grupoId, evento, carimbo) {
  const linhas = ['BEGIN:VEVENT', `UID:${uidDoEvento(grupoId, evento)}`, `DTSTAMP:${carimbo}`];

  if (evento.horaInicio) {
    // Uma mensagem diz "sábado às 20h" e cala-se sobre a hora de acabar.
    // Sem hora de fim, o DTEND ficava igual ao DTSTART e o evento entrava
    // na agenda das pessoas com duração zero — um risco fino que quase não
    // se vê na vista de semana. Duas horas é o que dura quase tudo neste
    // calendário (o Pro Five é 20h-22h).
    const fim = evento.horaFim || somarHoras(evento.horaInicio, 2);
    const diaFim = evento.dataFim || evento.data;
    linhas.push(`DTSTART;TZID=Europe/Lisbon:${evento.data}T${evento.horaInicio}00`);
    linhas.push(`DTEND;TZID=Europe/Lisbon:${diaFim}T${fim}00`);
  } else {
    // Evento de dia inteiro. O DTEND do iCalendar é EXCLUSIVO: para um
    // evento que ocupa o dia 12, o fim é o dia 13. O que estava publicado
    // punha DTEND igual ao DTSTART (duração zero) e, nos de vários dias,
    // acabava um dia cedo — "Espanha 18 a 20" aparecia a acabar no 19.
    linhas.push(`DTSTART;VALUE=DATE:${evento.data}`);
    linhas.push(`DTEND;VALUE=DATE:${diaSeguinte(evento.dataFim || evento.data)}`);
  }

  linhas.push(`SUMMARY:${escapar(evento.titulo)}`);
  if (evento.local) linhas.push(`LOCATION:${escapar(evento.local)}`);
  if (evento.notas) linhas.push(`DESCRIPTION:${escapar(evento.notas)}`);
  // SEQUENCE só sobe quando um evento JÁ PUBLICADO muda de hora (o robô da
  // agenda trata disso). Sem ele, há clientes que ignoram a alteração e
  // ficam com a hora antiga para sempre.
  linhas.push(`SEQUENCE:${Number(evento.seq) || 0}`);
  linhas.push(`LAST-MODIFIED:${carimbo}`);
  linhas.push('END:VEVENT');
  return linhas;
}

export function gerarIcs(grupo, carimbo) {
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Manancial//Agenda//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapar(grupo.nomeCalendario || grupo.titulo)}`,
    'X-WR-TIMEZONE:Europe/Lisbon',
    // Pedido de "relê de 4 em 4 horas". O Apple Calendar respeita; o Google
    // usa o ritmo dele (costuma ser algumas horas, às vezes até um dia) e
    // não há forma de o obrigar a ir mais depressa.
    'X-PUBLISHED-TTL:PT4H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    ...VTIMEZONE,
  ];

  for (const evento of grupo.eventos) linhas.push(...blocoEvento(grupo.id, evento, carimbo));

  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}

function carimboDe(agenda) {
  const d = agenda.atualizadoEm ? new Date(agenda.atualizadoEm) : new Date();
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

export function lerAgenda(ficheiro = FICHEIRO_AGENDA) {
  return JSON.parse(fs.readFileSync(ficheiro, 'utf8'));
}

export function gerarTudo() {
  const agenda = lerAgenda();
  const carimbo = carimboDe(agenda);

  fs.mkdirSync(PASTA_CALENDARIOS, { recursive: true });

  // Apaga .ics de grupos que já não existem, senão fica lá um ficheiro
  // fantasma a servir datas antigas a quem o assinou.
  const ids = new Set(agenda.grupos.map(g => g.id));
  for (const f of fs.readdirSync(PASTA_CALENDARIOS)) {
    if (f.endsWith('.ics') && !ids.has(f.slice(0, -4))) {
      fs.unlinkSync(path.join(PASTA_CALENDARIOS, f));
      console.log(`   removido calendars/${f} (grupo já não existe)`);
    }
  }

  for (const grupo of agenda.grupos) {
    fs.writeFileSync(path.join(PASTA_CALENDARIOS, `${grupo.id}.ics`), gerarIcs(grupo, carimbo), 'utf8');
  }

  fs.writeFileSync(
    path.join(PASTA_CALENDARIOS, '_registry.json'),
    JSON.stringify(agenda.grupos.map(g => g.id), null, 2) + '\n',
    'utf8',
  );

  const total = agenda.grupos.reduce((s, g) => s + g.eventos.length, 0);
  return { grupos: agenda.grupos.length, eventos: total };
}

// `node scripts/gerar.mjs` corre; importado por outro módulo, não corre.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = gerarTudo();
  console.log(`✅ ${r.grupos} calendários gerados, ${r.eventos} eventos.`);
}
