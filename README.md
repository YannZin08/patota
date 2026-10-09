# Patota

Site para controlar a patota: cadastro de jogadores, presença de cada dia de jogo,
times, placar ao vivo e artilharia. Funciona no navegador do celular, sem instalar nada,
e todo mundo que abre o link vê o placar atualizando sozinho.

## Telas

- **Jogos**: cria o dia de jogo e lista os dias anteriores com o artilheiro de cada um.
- **Dia de jogo**: abas *Presença* (quem veio), *Times* (sortear ou escolher a cor de cada um)
  e *Partidas* (começar partida, ver resultados e a artilharia do dia).
- **Partida**: placar grande; toque no nome de quem fez o gol. Dá para desfazer, marcar gol
  contra, encerrar e reabrir a partida.
- **Jogadores**: cadastro com nome, apelido e posição (linha ou goleiro). Quem já jogou é
  desativado em vez de apagado, para não sumir das estatísticas.
- **Estatísticas**: ranking por gols, presenças ou vitórias, no geral, no ano, no mês ou no
  último dia.

## Como funciona por dentro

- `public/`: o site (HTML, CSS e JavaScript puro, sem build).
- `api/`: funções da Vercel (`/api/state`, `/api/players`, `/api/day`, `/api/config`).
- `lib/store.js`: guarda os dados em JSON no **Vercel Blob** (store privado). Cada gravação
  confere o ETag, então dois celulares marcando gol ao mesmo tempo não se atropelam.
- `lib/domain.js`: regras (presença, times, partidas, gols, validações).

Arquivos guardados no Blob: `patota/config.json`, `patota/players.json` e um
`patota/days/<id>.json` por dia de jogo.

## Rodar no computador

```bash
npm install
npm run dev
# abra http://localhost:3000
```

Sem `BLOB_READ_WRITE_TOKEN`, os dados ficam na pasta `.data/`.

## Publicar na Vercel

1. Importe este repositório em vercel.com (Add New → Project). Não precisa mudar nada.
2. No projeto: **Storage → Create → Blob**, escolha acesso **Private** e conecte ao projeto.
   Isso cria a variável `BLOB_READ_WRITE_TOKEN`.
3. Faça um **Redeploy** para o site passar a usar o Blob.

### PIN opcional

Para impedir que alguém de fora altere os dados, crie a variável de ambiente `PATOTA_PIN`
na Vercel (ex.: `1234`) e faça redeploy. Ver continua aberto para todos; para alterar,
o site pede o PIN uma vez em cada celular.
