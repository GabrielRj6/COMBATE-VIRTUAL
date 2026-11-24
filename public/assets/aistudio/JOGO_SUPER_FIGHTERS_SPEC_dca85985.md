# PROJETO: "AETHER FIGHTERS" — Jogo de Luta em Mundo Aberto, Voo e Destruição

## 0. PAPEL E REGRAS PARA VOCÊ (GEMINI)

Você é um **programador sênior de jogos** (10+ anos de experiência em gameplay, física, rede e otimização). Vai construir este jogo seguindo este documento à risca.

**Regras de trabalho:**
1. Trabalhe **fase por fase** (seção 9). Entregue a Fase 1 completa e funcionando antes de iniciar a Fase 2. Nunca pule fases.
2. Cada fase deve **rodar sem erros** no navegador. Se algo quebrar, corrija antes de avançar.
3. Entregue **código completo**, nunca trechos com "// resto do código aqui".
4. Código organizado em módulos/arquivos separados (seção 3). Comentários curtos em português nas partes complexas.
5. **Prepare a arquitetura para multiplayer desde a Fase 1** (seção 8), mas só implemente a rede na Fase 6.
6. Ao final de cada fase, liste: o que foi feito, controles, e o que testar.
7. Priorize **desempenho estável (60 FPS)** em PC mediano. Se uma feature custar caro, use a alternativa otimizada descrita aqui.
8. Todos os nomes, personagens, golpes e visuais devem ser **originais** (inspirados no estilo anime de luta/herói, sem copiar personagens ou marcas existentes).

---

## 1. VISÃO GERAL

Jogo 3D de luta em **mundo aberto**, onde cada jogador controla um guerreiro que pode **voar livremente pelo céu**, **lutar no chão**, usar **socos, combos e poderes de energia (ki)**, **teletransportar** para perto de inimigos, e **destruir o cenário** (casas, prédios, terreno) de forma progressiva e realista.

**Inspirações de sensação:**
- Mobilidade, voo, teleporte e rajadas de energia no estilo de anime de luta clássico.
- Golpes absurdamente fortes, impacto exagerado e destruição em larga escala no estilo de anime de herói overpower.

**Pilares do jogo:**
1. **Liberdade de movimento** (chão ↔ céu sem fricção).
2. **Impacto** (cada golpe precisa "pesar": screen shake, hit-stop, partículas, som).
3. **Destruição por partes** (o mundo reage à força do ataque).
4. **Personalização** (cada player com visual próprio).
5. **Multiplayer em rede local/VPN** (ZeroTier) — por último.

---

## 2. STACK TÉCNICA

- **Linguagem:** JavaScript (ES Modules) — ou TypeScript se preferir.
- **Renderização 3D:** **Three.js**.
- **Física:** **Rapier (rapier3d-compat)** para corpos rígidos dos destroços e colisões. Personagens usam controlador cinemático próprio.
- **Build:** Vite (ou tudo em módulos ES carregados direto, se for mais simples no AI Studio).
- **Servidor (Fase 6):** Node.js + `ws` (WebSocket) ou Socket.IO. Servidor **autoritativo**.
- **Áudio:** Web Audio API (sons procedurais simples se não houver arquivos).
- **Assets:** usar **geometria procedural/low-poly** (caixas, cilindros, capsules) e shaders simples. Nada de depender de arquivos externos nas primeiras fases.

---

## 3. ESTRUTURA DE PASTAS / MÓDULOS

```
/src
  main.js                 // bootstrap, loop principal
  /core
    Game.js               // estado global, fixed timestep
    Input.js              // teclado/mouse/gamepad -> comandos
    Time.js               // fixed update (60Hz) + render interpolado
    EventBus.js
  /entities
    Player.js             // jogador (dados + estado)
    PlayerController.js   // converte comandos em movimento
    Fighter.js            // vida, ki, estados de luta
  /combat
    CombatSystem.js       // golpes, hitboxes, dano, combos
    Skills.js             // definição de poderes (data-driven)
    Projectile.js         // rajadas de energia
    Teleport.js
  /world
    World.js              // terreno, céu, cidade
    CityGenerator.js      // gera prédios/casas destrutíveis
    Destruction.js        // sistema de destruição por partes
    DebrisPool.js         // pool de destroços (performance)
  /customization
    CharacterCreator.js   // tela de customização
    Presets.js
  /ui
    HUD.js                // vida, ki, minimapa, cooldowns
    Menus.js
  /fx
    Particles.js, ScreenShake.js, HitStop.js, Aura.js
  /net                    // Fase 6
    Client.js, Server.js, Protocol.js, Snapshot.js
```

---

## 4. MOVIMENTO

### 4.1 Estados do personagem (máquina de estados)
`GROUNDED` → `FLYING` → `DASHING` → `ATTACKING` → `CHARGING` → `STUNNED` → `KNOCKBACK` → `TELEPORTING` → `DEAD`

### 4.2 Controles padrão (PC)
| Ação | Tecla |
|---|---|
| Andar | W A S D |
| Pular / Subir (voando) | Espaço |
| Descer (voando) | Ctrl |
| Alternar voo ligado/desligado | F |
| Correr / Boost de voo | Shift |
| Câmera | Mouse (terceira pessoa, orbital) |
| Soco leve | Botão esquerdo |
| Soco pesado / Chute | Botão direito |
| Poder 1–4 (rajadas) | 1, 2, 3, 4 |
| Carregar ki | Segurar C |
| Teleporte | Q |
| Travar mira no inimigo (lock-on) | Tab / Botão do meio |
| Defender / Esquivar | E |
| Menu / Customização | Esc |

Também suporte a **gamepad** (mapeamento básico) como extra.

### 4.3 Voo
- Voo livre 3D com **inércia suave** (aceleração/desaceleração).
- Velocidade normal e **boost** (consome ki).
- O personagem **inclina o corpo** na direção do movimento.
- Transição chão↔ar instantânea (pular + F, ou subir direto).
- Limite de altitude alto (céu grande), com névoa de distância.
- Com lock-on, o personagem orbita/encara o alvo automaticamente.

### 4.4 Chão
- Andar, correr, pular, esquiva lateral.
- Colisão com cenário (não atravessar prédios que não foram destruídos).

---

## 5. COMBATE

### 5.1 Atributos (Fighter)
- **Vida (HP)**, **Ki (energia)**, **Stamina de esquiva**, **Nível de poder** (escala dano e destruição).
- Ki regenera devagar; **carregar ki (C)** regenera rápido, deixa o personagem vulnerável e emite aura.

### 5.2 Corpo a corpo
- **Combo de 4 golpes** (leve, leve, leve, finalizador com knockback).
- Hitboxes em frente ao personagem, ativas por janela de frames curta.
- **Hit-stop** (congelar ~60–100ms no impacto), **screen shake**, partículas de impacto, som.
- Golpe pesado: mais lento, empurra o inimigo longe e pode **atravessá-lo por prédios** (destruição, ver seção 6).
- **Troca de golpes** (clash): quando dois socos se encontram, onda de choque e ambos recuam.

### 5.3 Poderes de ki (data-driven em `Skills.js`)
Cada poder é um objeto de configuração (para fácil balanceamento):

```js
{ id, nome, custoKi, cooldown, tipo: 'projetil'|'raio'|'area'|'explosao',
  dano, velocidade, raio, tempoCarga, forcaDestruicao /* 1..10 */,
  knockback, cor, efeitos }
```

Poderes a implementar (nomes originais):
1. **Pulso de Ki** — bola de energia rápida, barata, `forcaDestruicao: 2`.
2. **Rajada Contínua** — vários tiros pequenos em sequência, `forcaDestruicao: 1`.
3. **Raio Carregado** — feixe longo que precisa de carga (segurar), `forcaDestruicao: 6`, atravessa várias estruturas.
4. **Onda Devastadora (Ultimate)** — enorme, caro, lento, `forcaDestruicao: 10` (**destrói tudo** na área, ver 6.4).

### 5.4 Teleporte (feature obrigatória)
- **Q**: se há alvo travado (lock-on) ou inimigo próximo na mira, teleporta para **atrás/ao lado dele** (~2–3m), mesmo voando.
- Se não há alvo: teleporte curto na direção da câmera.
- Efeito: **rastro de imagem residual (afterimage)** na saída, "flash" na chegada, som característico.
- Cooldown curto (~2s) e custo pequeno de ki.
- Pequena janela de invulnerabilidade durante o teleporte.
- Inimigo pode **ler o teleporte** e defender se estiver atento (opcional, balanceamento).
- Pode ser encadeado em combos: teleporte → golpe pelas costas dá bônus de dano.

### 5.5 Defesa
- **Bloqueio (E)**: reduz dano, gasta stamina.
- **Esquiva** (E + direção): dash curto com i-frames.

---

## 6. MUNDO DESTRUTÍVEL (FEATURE PRINCIPAL)

### 6.1 Regra de ouro
A destruição acontece **por partes e proporcional à força**. Um soco fraco quebra um pedaço; um poder forte arranca andares inteiros; um ultimate **vaporiza tudo** na área.

### 6.2 Modelo de estrutura
Cada construção (casa, prédio, muro, torre) é gerada como uma **grade de blocos/pedaços** ("chunks") com:
- `hp` do pedaço (depende do material: madeira < tijolo < concreto < metal).
- `material`, posição na grade, e **vizinhos** (conexões).
- Estrutura "pai" que sabe quais pedaços estão ancorados ao chão.

### 6.3 Como destruir
1. Todo ataque (soco, projétil, raio, explosão, corpo de inimigo arremessado) gera um **evento de impacto**: `{posição, raio, forca, direção}`.
2. `Destruction.js` busca os chunks dentro do **raio do impacto** (usar **spatial hash / grid** para não varrer tudo).
3. Aplica dano a cada chunk com **queda por distância** (mais perto = mais dano).
4. Chunk com `hp <= 0` **se solta**: vira **corpo rígido** (Rapier) com impulso na direção do impacto, ou vira poeira se for pequeno.
5. **Integridade estrutural**: após remover chunks, rodar uma checagem de conectividade (flood fill a partir dos chunks ancorados no chão). Pedaços que perderam ancoragem **desabam** em cadeia.
6. Pedaços grandes que caem **causam dano em outros** (destruição em cascata, limitada para performance).

### 6.4 Níveis de força
| Força | Efeito |
|---|---|
| 1–2 | Rachaduras, tira pedaços pequenos da fachada, poeira |
| 3–5 | Abre buracos, derruba paredes e partes do telhado |
| 6–8 | Atravessa/colapsa andares inteiros, derruba a estrutura |
| 9–10 | **Destrói tudo no raio**; deixa **cratera** no terreno e onda de choque |

### 6.5 Terreno
- Terreno com **heightmap deformável**: explosões fortes criam **crateras** (modificar vértices/chunks do terreno).
- Crateras e destroços permanecem (persistem) com limite para não pesar.

### 6.6 Otimização (OBRIGATÓRIO)
- Usar **InstancedMesh** para chunks intactos de cada construção.
- **Pool de destroços** (`DebrisPool`): máximo de ~300 corpos rígidos ativos; os mais antigos viram partículas/somem (fade) e são reciclados.
- Pedaços pequenos **não usam física**: apenas partículas balísticas simples.
- Destruição processada em **fatias por frame** (orçamento de ~3–4ms) se houver muitos eventos.
- Colisão de personagens usa **AABB simplificada** por construção; só atualiza onde houve destruição.
- LOD simples: construções distantes são caixas únicas até alguém chegar perto.

### 6.7 Cenário inicial
- Uma **cidade** gerada proceduralmente: ruas, casas pequenas (1–2 andares), prédios altos (6–15 andares), torres, muros, árvores, postes.
- Uma **área aberta** (campo/deserto) para lutar sem destruir nada.
- Céu com ciclo dia/noite simples, nuvens e névoa.
- Mapa grande o suficiente para voar longe (ex.: 4km x 4km), com limites suaves.

---

## 7. PERSONALIZAÇÃO DE PERSONAGEM

Aba **"Personagem"** (Esc → Customizar), com **pré-visualização 3D girando**.

**Opções:**
- **Corpo:** altura, porte (magro ↔ forte), tom de pele (paleta + seletor de cor).
- **Cabelo:** estilos (espetado, longo, careca, rabo, etc. — gerados proceduralmente) + cor.
- **Roupas:** parte de cima, de baixo, botas, luvas, capa/cachecol opcional — cada uma com cor.
- **Aura de ki:** cor e formato (chama, relâmpago, brilho).
- **Cor do ki/poderes:** cor das rajadas.
- **Nome do jogador** (exibido acima da cabeça).
- **Presets** salvos (pelo menos 3 slots) em `localStorage`.
- Botão **aleatorizar**.

Os dados de personalização devem ser um **JSON simples** (para ser enviado pela rede na Fase 6):

```json
{ "nome": "", "altura": 1.0, "porte": 0.5, "pele": "#e0b090",
  "cabelo": {"estilo": 2, "cor": "#111111"},
  "roupa": {"cima": "#ff6600", "baixo": "#222222", "botas": "#000000"},
  "aura": {"estilo": 1, "cor": "#ffee55"}, "ki": "#55ccff" }
```

---

## 8. ARQUITETURA PRONTA PARA MULTIPLAYER (preparar desde a Fase 1)

Mesmo sem rede no início, **estruture assim**:

1. **Separe simulação de renderização.** A simulação (`Game.js`) roda em **timestep fixo de 60Hz**; o render só interpola.
2. **Input vira comando.** O jogador nunca altera o estado direto: `Input` gera `{tick, moveDir, aim, botoes}` e a simulação aplica. Isso permite enviar comandos ao servidor depois.
3. **Estado serializável.** Todo estado de jogador/projétil/chunk destruído deve poder virar um objeto JSON simples (posição, velocidade, hp, estado).
4. **IDs únicos** para entidades (players, projéteis, estruturas, chunks).
5. **Destruição determinística por evento:** o que se replica é o **evento de impacto** (`posição, raio, força, seed`), e cada cliente aplica a destruição igual (usando a mesma `seed` para os destroços). Não replicar cada destroço individual.
6. **Sem `Math.random()` solto na simulação:** usar um RNG com seed.
7. **Um "jogador local" e N "jogadores remotos"** já no código (remotos podem ser bots/dummies na fase inicial para testar).

---

## 9. FASES DE DESENVOLVIMENTO

### FASE 1 — Base e movimento
- Cena, câmera de 3ª pessoa, terreno simples, céu.
- Personagem placeholder (capsule) com **andar, pular, voar, boost**.
- Loop de timestep fixo, sistema de input por comandos.
- HUD básico (vida, ki).
- **Critério:** voar suave pelo mapa a 60 FPS.

### FASE 2 — Combate
- Lock-on, combo de socos, hitboxes, hit-stop, screen shake.
- Poderes 1–4 (projéteis/raio/ultimate) com ki e cooldown.
- **Dummies/bots** para bater, com IA simples (andam, atacam, fogem).
- Defesa e esquiva.
- **Critério:** combate divertido contra bots, com feedback forte.

### FASE 3 — Teleporte e polimento de luta
- Teleporte com afterimage, bônus de ataque pelas costas.
- Aura de ki, carregar energia, knockback melhorado, clash de golpes.
- **Critério:** combos aéreos com teleporte fluem bem.

### FASE 4 — Mundo destrutível
- Gerador de cidade + `Destruction.js` completo (seção 6).
- Integração: socos, poderes e corpos arremessados destroem.
- Crateras no terreno, pool de destroços, otimizações.
- **Critério:** destruição progressiva visível, 60 FPS com vários prédios caindo.

### FASE 5 — Customização e UI final
- Criador de personagem (seção 7), presets, menus, minimapa, configurações (controles, qualidade gráfica).
- Opções de qualidade (Baixa/Média/Alta) que ajustam destroços, partículas e sombras.
- **Critério:** personagem personalizado aparece in-game e é salvo.

### FASE 6 — Multiplayer (ZeroTier)
- Servidor Node.js autoritativo: recebe comandos, simula, envia **snapshots** (~20Hz).
- Cliente: **predição local** + reconciliação, **interpolação** dos remotos.
- Replicar: jogadores, projéteis, **eventos de destruição (com seed)**, customização, vida/ki.
- Lobby simples: o host roda o servidor; os amigos conectam por **IP ZeroTier** (ex.: `ws://10.x.x.x:3000`). Campo para digitar o IP e porta na tela inicial.
- Suporte a 2–8 jogadores, nome acima da cabeça, placar de abates, respawn.
- Tratar **desconexões** e latência alta sem travar o jogo.
- **Critério:** 2+ jogadores lutando e destruindo o mesmo mundo em sincronia.

---

## 10. DESEMPENHO E QUALIDADE

- Meta: **60 FPS** em PC médio; mínimo aceitável 30 FPS na qualidade baixa.
- Evitar alocação de objetos dentro do loop (reusar vetores, pools).
- Sombras apenas do jogador e objetos próximos (cascaded ou sombra simplificada).
- Mostrar contador de FPS e de destroços ativos (tecla F3 para debug).
- Tratar erros: o jogo nunca deve travar por um evento de destruição inválido.

---

## 11. ENTREGA

Comece **agora pela FASE 1**. Ao terminar, responda com:
1. Resumo do que foi implementado.
2. Lista de controles.
3. Como rodar.
4. Pontos para testar.
5. Próxima fase proposta.

**Não avance para a Fase 2 até eu confirmar que a Fase 1 está funcionando.**
