# AETHER FIGHTERS — FASE 2: COMBATE

## 0. PAPEL E REGRAS (GEMINI)

Você é um **programador sênior de jogos**. A **Fase 1 já está pronta e funcionando** neste projeto (movimento, voo, boost, dash, simulação 60Hz, `PlayerCommand`, `EventBus`, `SeededRNG`, HUD React). **Não reescreva a Fase 1.** Esta fase **adiciona** combate por cima dela.

**Regras:**
1. Mantenha a arquitetura: simulação em `src/core/Game.ts` **sem Three.js**; renderização em `SceneRenderer`/`fx`. Toda a lógica de combate deve rodar sem dependência de Three.js (será reutilizada no servidor na Fase 6).
2. **Nunca use `Math.random()` na simulação.** Use o `SeededRNG` do `Game`. (`Math.random()` só é permitido em efeitos puramente visuais: shake de câmera, áudio.)
3. Entregue **código completo**, sem "// resto aqui". Rode `tsc --noEmit` e `vite build` e corrija todos os erros antes de responder.
4. Não aloque objetos dentro do loop de 60Hz: use **pools** (projéteis, raios, pulsos de efeito).
5. Tudo que for balanceamento fica em **tabelas de dados** (`Skills.ts`), nunca espalhado no código.
6. Não implemente teleporte (Fase 3), destruição (Fase 4), customização (Fase 5) nem rede (Fase 6). Apenas **emita os eventos** previstos aqui.
7. Ao terminar, responda com: resumo, controles, como testar e a lista de arquivos criados/alterados.

---

## 1. ARQUIVOS

**Criar:**
```
src/combat/Skills.ts        // tabelas de golpes e poderes (seção 3)
src/combat/CombatState.ts   // estado de combate por jogador (seção 4)
src/combat/Projectile.ts    // projétil em pool + BeamFx (seção 6)
src/combat/CombatSystem.ts  // núcleo do combate (seções 5–9)
src/combat/BotAI.ts         // IA dos bots (seção 10)
src/fx/CombatFX.ts          // efeitos visuais em pool (seção 12)
```

**Alterar:** `core/EventBus.ts`, `core/Input.ts`, `core/Game.ts`, `entities/Player.ts`, `entities/PlayerController.ts`, `entities/CharacterMesh.ts`, `renderer/SceneRenderer.ts`, `fx/AudioEngine.ts`, `ui/HUD.tsx`, `App.tsx`.

---

## 2. CONTROLES

| Ação | Tecla |
|---|---|
| Soco leve (combo de 4) | Botão esquerdo |
| Golpe pesado | Botão direito |
| Poderes 1 / 2 / 3 / 4 | Teclas 1, 2, 3, 4 |
| Travar / destravar alvo | Tab ou botão do meio |
| Defender | E (segurar) |
| Esquiva | E + direção (já existe como dash da Fase 1) |

`Input.ts` já gera `lightAttack`, `heavyAttack`, `skillSlot`, `lockOnPressed`, `defend`. Adicione apenas o método:

```ts
steerCamera(targetYaw, targetPitch, dt) // amortece yaw (menor arco) e pitch em direção ao alvo, lambda ≈ 7
```

---

## 3. TABELAS DE DADOS (`Skills.ts`)

### 3.1 Golpes corpo a corpo
```ts
interface MeleeMove {
  id; dano; total; hitAt; alcance; lunge; knockback; launch; stun; hitStop; shake; kiGanho; forca;
}
```
| id | dano | total(s) | hitAt(s) | alcance | lunge | knockback | launch | stun | hitStop | shake | kiGanho | forca |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | 38 | 0.30 | 0.10 | 3.1 | 22 | 5 | 0 | 0.26 | 0.045 | 0.18 | 3 | 1 |
| L2 | 42 | 0.30 | 0.10 | 3.1 | 22 | 6 | 0 | 0.28 | 0.05 | 0.20 | 3 | 1 |
| L3 | 50 | 0.36 | 0.13 | 3.3 | 24 | 8 | 0 | 0.30 | 0.06 | 0.26 | 4 | 2 |
| L4 (finalizador) | 95 | 0.58 | 0.24 | 3.6 | 28 | 36 | 6 | 0.55 | 0.10 | 0.60 | 8 | 3 |
| H (pesado) | 130 | 0.78 | 0.38 | 3.8 | 26 | 46 | 8 | 0.65 | 0.11 | 0.75 | 10 | 4 |

Constantes: `COMBO_WINDOW = 0.38`, `INPUT_BUFFER = 0.28`, `MELEE_MOVE_SCALE = 0.3`, `BLOCK_MELEE_REDUCTION = 0.2` (recebe 20% do dano), `BLOCK_KI_REDUCTION = 0.4`, `BLOCK_STAMINA_PER_DAMAGE = 0.55`, `GUARD_BREAK_STUN = 1.0`, `RESPAWN_TIME_PLAYER = 3.0`, `RESPAWN_TIME_BOT = 4.5`.

### 3.2 Poderes de ki (nomes originais)
```ts
interface SkillDef {
  id; nome; kind: 'projectile'|'burst'|'beam'|'ultimate';
  custoKi; cooldown; tempoCarga; dano; velocidade; raio; raioExplosao;
  knockback; forcaDestruicao; tiros?; intervalo?; alcance?; largura?; cor;
}
```
| slot | nome | kind | ki | cooldown | carga | dano | vel | raio | explosão | knockback | força |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pulso de Ki | projectile | 8 | 0.45 | 0.10 | 55 | 95 | 0.55 | 3.2 | 16 | 2 |
| 2 | Rajada Contínua | burst | 22 | 3.0 | 0.10 | 17 (por tiro) | 115 | 0.30 | 1.6 | 6 | 1 |
| 3 | Raio Carregado | beam | 40 | 7.0 | 0.90 | 210 | — | 1.1 | 4.0 | 34 | 6 |
| 4 | Onda Devastadora | ultimate | 80 | 20.0 | 1.60 | 600 | 58 | 4.2 | 24 | 70 | 10 |

Extras: Rajada: `tiros: 7`, `intervalo: 0.085`. Raio: `alcance: 150`, `largura: 1.6`. `cor` vazia = usa a cor de ki do jogador (`appearance.ki`).

---

## 4. ESTADO DE COMBATE

`CombatState` (sem Three.js), guardado em `player.combat`:

```
lockTargetId, attackKind('none'|'light'|'heavy'|'skill'), attackTimer, attackDuration, attackMove,
hitDone, comboIndex, comboWindow, buffered('light'|'heavy'|null), bufferTimer, aimYaw,
castSlot, castTimer, castDuration, burstLeft, burstTimer, cooldowns[4],
invulnTimer, stunTimer, stunImmune, isBlocking, lastHitBy, respawnTimer, hitFlash
```
Helpers: `isBusy` (attackTimer>0 || castTimer>0 || burstLeft>0), `attackProgress()` (0..1), `cancelActions()`.

**Em `Player`:** adicionar `combat`, `isBot`, `spawn` (posição inicial), `kills`, `deaths`, `controlLock` (>0 = sem controle de movimento) e `moveScale` (multiplicador de velocidade).

**Em `PlayerController.step`:** antes de qualquer lógica, aplicar modificadores sem alterar o comando original (usar um comando "scratch" reutilizável):
- `controlLock > 0`: decrementa e zera movimento, boost, carga, pulo, dash e toggle de voo (mantém câmera). Durante o knockback, use fricção de solo **3.0** (em vez de 14) e drag de voo **2.1** (em vez de 4.6), para o empurrão deslizar.
- `moveScale < 1`: multiplica `moveForward/moveRight/moveUp` e desliga boost/carga.

---

## 5. LOOP DE COMBATE (`CombatSystem.step(player, cmd, dt)`)

Chamado **depois** de `controller.step` para cada jogador, a cada tick. Ordem:

1. **Morto?** → `updateDead` (corpo cai com gravidade, desliza, conta `respawnTimer`, respawna) e retorna.
2. Decrementar timers (`invuln`, `hitFlash`, `cooldowns`, `buffer`, `comboWindow`; ao fim da janela, `comboIndex = 0`).
3. **Lock-on:** `lockOnPressed` alterna (só jogador humano). Validar o alvo todo tick (vivo e a < 312 m, senão destrava).
4. **Atordoado** (`stunTimer > 0`): sem ações; estado vira `KNOCKBACK` (se `controlLock>0`) ou `STUNNED`. Ao terminar, `stunImmune = 0.5`. Retorna.
5. **Esquiva cancela** ações em andamento (`dashTimer > 0 && isBusy`).
6. **Bloqueio:** `isBlocking = defend && !isBusy && dashTimer<=0 && stamina>1`.
7. **Buffer de ataque:** `lightAttack`/`heavyAttack` guardam o pedido por `INPUT_BUFFER`.
8. **Poder:** `skillSlot>0 && !isBusy` → `tryStartSkill`.
9. Se livre e há ataque bufferizado (e não está bloqueando) → `startMelee`.
10. `updateMelee`, `updateCast`.
11. **Modificadores/estado:** castando = `moveScale 0.12` + `ATTACKING`; atacando = `moveScale 0.3` + `ATTACKING`; bloqueando = `0.5`; senão `1`.

**Anti stun-lock:** em `applyHit`, se `stun < 0.5` e `stunImmune > 0` e não está atordoado, ignora o stun (o dano e o knockback continuam). Golpes fortes (finalizador, pesado, raio, ultimate) sempre atordoam.

---

## 6. MIRA

`computeAim(player, cmd|null, maxDist, lead)` retorna direção 3D normalizada, `targetId` e distância:

1. Direção base: com `cmd`, a frente da câmera `(-sin yaw, -sin(pitch-0.22), -cos yaw)` (o `-0.22` é o pitch padrão da câmera, para não atirar para baixo); sem `cmd`, a direção do corpo.
2. **Lock-on ativo e vivo** → mira direto no peito do alvo (altura 1.0 m).
3. **Sem lock** → auto-assist: o inimigo mais próximo dentro de `maxDist` com `dot(dirBase, dirAlvo) > 0.9`.
4. `lead > 0` (poderes): mira na **posição prevista** `alvo.pos + alvo.vel * (dist / lead)`.

Bots nunca mirem em bots (`attacker.isBot && target.isBot` → ignorar, sem fogo amigo).

---

## 7. CORPO A CORPO

**`startMelee(kind)`**
- Leve usa `LIGHT_COMBO[comboIndex]` e avança o índice (módulo 4). Pesado zera o combo.
- Define `attackTimer = total`, `hitDone = false`, calcula a mira com alcance de auto-assist **9 m**, trava `facingYaw = aimYaw`.
- **Avanço magnético:** se há alvo a menos de 14 m, velocidade = `clamp((dist − 1.7) / 0.1, 0, move.lunge)`; sem alvo, `lunge × 0.28`. Aplica vertical se o jogador está voando/no ar ou o alvo está bem acima.
- Emite `combat:attack`.

**`updateMelee`:** ao passar `hitAt`, chama `doMeleeHit` uma única vez. No fim do golpe, se foi leve, abre `comboWindow = COMBO_WINDOW`.

**`doMeleeHit`:** para cada inimigo vivo com distância ≤ `alcance + 0.9` e dentro do cone frontal (`dot(forward, dirAlvo) ≥ 0.25`, ou muito perto), chama `applyHit`. Ganha `kiGanho` ao acertar. Se `forca ≥ 3` e acertou, emite `impact:event` no ponto de contato (raio `3 + forca*0.5`).

---

## 8. PODERES DE KI

- **`tryStartSkill`:** exige cooldown 0 e ki ≥ custo. Desconta o ki **na hora**, inicia o cooldown, `castTimer = tempoCarga`, emite `skill:charge` e `combat:attack`.
- **`updateCast`:** durante a carga, a mira rastreia o alvo, o corpo freia (×0.9). Ao zerar, `fireSkill`.
- **`fireSkill`** por tipo:
  - `projectile`: cria 1 projétil; recuperação 0.18 s.
  - `ultimate`: 1 projétil gigante, recuo no atirador (12), shake forte; recuperação 0.8 s.
  - `burst`: dispara `tiros` projéteis a cada `intervalo`, com espalhamento (±0.035/±0.03) via `SeededRNG`; recuperação 0.2 s ao final.
  - `beam`: **instantâneo** (seção 8.2); recuo 8; recuperação 0.45 s.
- Emite `skill:fire`.

### 8.1 Projéteis (pool de 64)
Campos: `active, id, ownerId, skill, x,y,z, vx,vy,vz, life(4s), radius, colorHex`. A cada tick:
- Move com **varredura de segmento** (evita atravessar alvos em alta velocidade).
- Colide com: jogador (distância segmento→peito ≤ `raio + 0.7`), prédios (segmento × AABB expandida em `raio*0.6`, método slab), terreno (`y <= groundHeightAt + raio*0.5`, testando também o ponto médio) e fim da vida.
- Ao colidir: `explode`.

**`explode`:** dano em área para todo inimigo vivo a ≤ `raioExplosao + 0.7`. `falloff = max(0.35, 1 − (d/(R+0.7))*0.65)`. Knockback radial, `launch` 8 se `knockback>30` senão 2. Emite `projectile:explode`, `impact:event` (seed vinda do `SeededRNG`) e shake proporcional à distância do jogador local (zero além de 70 m).

### 8.2 Raio (`beam`)
Segmento da origem (peito + 1.1 m na mira) até `alcance`. **Corta** no primeiro prédio (slab) e no terreno (amostragem a cada 1/80 do comprimento). Todo inimigo com distância ao segmento ≤ `largura + 0.7` leva o dano uma vez (`launch 4`, `stun 0.8`, hit-stop 0.09). Registra um `BeamFx` (pool de 6, vida 0.5 s) e emite `projectile:explode` + `impact:event` no ponto final.

---

## 9. DANO (`applyHit`)

Retorna `true` se houve contato. Ordem:

1. Alvo morto → ignora.
2. **Esquiva:** `invulnTimer > 0` ou `dashTimer > 0` → emite `combat:dodge` e retorna `false`.
3. **Bloqueio:** só vale se o golpe vem pela frente (`−dot(dir, facing) > −0.1`).
   - Stamina suficiente (`dano × 0.55`): dano × 0.2 (melee) ou × 0.4 (ki), knockback × 0.35, sem launch, stun 0.08.
   - Stamina insuficiente: stamina = 0, stun = 1.0 (`combat:guardbreak`).
4. Subtrai HP, marca `lastHitBy`, `hitFlash = 0.16`, emite `combat:hit` (kind `light|heavy|skill|blocked`, `power` 0..1 = dano/220).
5. **Hit-stop e shake** só se o jogador local participa.
6. HP ≤ 0 → `kill`. Senão: aplica stun (cancela ações, `controlLock = stun`) e knockback (`vel = dir × kb`, `vel.y = dir.y × kb × 0.45 + launch`).

**`kill`:** estado `DEAD`, soma abate/queda, empurra o corpo, emite `fighter:death`, shake forte.
**`respawn`:** HP/ki/stamina cheios, volta ao `spawn`, `invulnTimer = 1.8`, emite `fighter:respawn`.

`powerLevel` multiplica o dano causado. **Bots usam `powerLevel = 0.75`.**

---

## 10. GAME LOOP E BOTS

`Game.fixedUpdate`:
```
se hitStop > 0: hitStop -= dt; retorna        // congela a simulação
controller.step(local) ; combat.step(local)
para cada bot: cmd = brain.think(...); controller.step(bot,cmd); combat.step(bot,cmd)
combat.updateProjectiles(dt)
consome combat.hitStopRequest
atualiza combo (zera após 2.4 s sem acerto)
```
Remova a patrulha de demonstração da Fase 1. No renderizador, **durante o hit-stop use `alpha = 1`** na interpolação (senão o boneco treme).

### Bots (`BotBrain`) — geram `PlayerCommand` como o jogador
Alvo: o jogador humano vivo mais próximo (bots não atacam bots). Sem alvo: pousa e carrega ki.
- **Voo:** skirmisher sempre voa; brawler voa se o alvo está a mais de 4 m do chão ou voando. Toggle com cooldown de 0.9 s. Altitude desejada: skirmisher `max(alvo.y+2, chão+9)`, brawler `alvo.y`.
- **Defesa:** se um projétil inimigo a < 26 m vem na direção dele (`dot > 0.9`), chance `reaction*0.18` por tick de esquivar (dash lateral, cooldown 1.3 s). Se o alvo está atacando a < 6 m, chance `reaction*0.05` de bloquear por 0.45 s.
- **brawler** (*Sora*, `reaction 0.6`, `aggression 0.85`): aproxima se `hdist > 4.2`, ataca com leves (18% de pesado) quando `dist < 4.6`, usa poderes 1/3/4 entre 12 e 70 m (intervalo 1.6–3.4 s).
- **skirmisher** (*Ryuji*, `reaction 0.7`, `aggression 0.7`): mantém 11–26 m, orbita (strafe), usa poderes 1/2/3/4, carrega ki quando baixo e longe, soca se for encurralado.

Ryuji nasce voando em (-16, 12, -18); Sora no chão em (20, 0, -14).

---

## 11. EVENTOS NOVOS (`EventBus`)

```
'combat:attack'      { playerId, kind:'light'|'heavy'|'skill', slot }
'combat:hit'         { attackerId, targetId, x,y,z, damage, kind:'light'|'heavy'|'skill'|'blocked', power }
'combat:dodge'       { playerId, x,y,z }
'combat:guardbreak'  { playerId }
'skill:charge'       { playerId, slot, duration }
'skill:fire'         { playerId, slot }
'projectile:explode' { x,y,z, radius, colorHex, power }
'fighter:death'      { playerId, killerId }
'fighter:respawn'    { playerId }
'camera:shake'       { intensity, duration }
'lock:change'        { playerId, targetId|null }
```
(`impact:event` já existe da Fase 1: **continue emitindo** nas explosões, raios e golpes fortes para a Fase 4.)

---

## 12. RENDERIZAÇÃO E FEEDBACK

**`CombatFX` (tudo em pool, zero alocação por frame):**
- **Projéteis:** um grupo por slot do pool (núcleo branco + brilho aditivo alongado na direção da velocidade, `lookAt`).
- **Raios:** 6 cilindros alinhados em +Z (núcleo branco + casca colorida) que afinam e somem com a vida.
- **Pulsos:** 40 esferas/anéis aditivos que expandem e somem (explosões, faíscas de impacto, anel de esquiva, nocaute). Cor: branco = leve, laranja = pesado, azul-claro = bloqueado, amarelo = poder.
- **Orbe de carga:** esfera à frente do atirador que cresce com o progresso da carga (maior no ultimate).
- Materiais `MeshBasicMaterial` aditivos, `depthWrite: false`, `toneMapped: false`.

**Câmera (`SceneRenderer`):**
- **Lock-on:** a cada frame, se há alvo, `input.steerCamera(yawAlvo, pitchAlvo, dt)`. `yaw = atan2(-dx, -dz)`, `pitch = clamp(0.22 − atan2(dy, distH)*0.55, −0.55, 1.0)`.
- **Shake:** intensidade decai linear; amplitude `0.38k² + 0.1k`, offset aleatório na posição + leve rotação Z. Reaproveita o maior shake ativo.
- Projeta o alvo travado na tela (`position.project(camera)`) e envia `screenX/screenY` (em %) ao HUD.

**`CharacterMesh`:** método `flash(power)` (emissive branco por 0.14 s) e `applyCombatPose` sobrepondo a pose depois da pose base:
- Nocauteado: corpo deitado (`bodyPivot.rotation.x = -1.45`, y 0.38).
- Castando: braços à frente com tremor.
- L1/L3 soco direito, L2 soco esquerdo (arma → estica → recolhe, usando `hitAt/total`), L4 chute giratório, H braços juntos em martelada.
- Atordoado/knockback: braços abertos, tronco para trás.
- Bloqueando: braços cruzados à frente do peito.

**Áudio (síntese procedural):** whoosh por tipo de golpe (só do jogador local), impacto (grave + ruído; versão metálica ao bloquear), quebra de guarda, subida de tom ao carregar ki, disparo por poder, explosão.

---

## 13. HUD (`HUD.tsx` + `HudTelemetry`)

Adicionar à telemetria: `lock` (id, nome, hp, maxHp, dist, screenX, screenY, onScreen), `skills[]` (slot, nome, custoKi, cooldown, cooldownMax, affordable), `comboHits`, `hurt`, `dead`, `respawnIn`, `kills`, `deaths`, `activeProjectiles`, `isBlocking`, `hitMarker`.

Elementos:
- **Barra de poderes** (canto inferior esquerdo): 4 slots com tecla, nome, custo ou tempo de recarga e overlay de cooldown; esmaecido se sem ki.
- **Painel do alvo** (topo centro): nome, distância, barra de vida.
- **Mira de lock-on:** losango girado sobre o alvo (esconde se fora da tela).
- **Contador de combo** (direita): aparece a partir de 2 acertos.
- **Marcador de acerto** (X no centro) e **vinheta vermelha** ao tomar dano.
- **Tela de nocaute:** "NOCAUTEADO — Renascendo em X s".
- **Placar** de abates/quedas no painel de status; "Defendendo" no estado.
- Dock de controles atualizado (clique esq/dir, 1–4, Tab, E) e contagem de projéteis no painel F3.

Telemetria continua sendo enviada a ~20 Hz.

---

## 14. CRITÉRIOS DE ACEITE

- [ ] `tsc --noEmit` e `vite build` sem erros; 60 FPS com 2 bots e vários projéteis.
- [ ] Tab trava o alvo; a câmera o acompanha; Tab de novo solta.
- [ ] Combo L1→L4 encadeia com cliques rápidos (janela 0.38 s); o finalizador arremessa.
- [ ] Os 4 poderes gastam ki, respeitam cooldown e explodem em jogador, prédio e terreno; o raio é cortado por prédios.
- [ ] Bloquear reduz o dano de frente e gasta stamina; sem stamina o bloqueio quebra; esquivar (E+dir) evita o golpe.
- [ ] Bots perseguem, atacam, bloqueiam e esquivam; Ryuji atira de longe, Sora luta de perto.
- [ ] Morrer mostra a tela de nocaute e respawna em 3 s com proteção; bots respawnam em 4.5 s.
- [ ] Não há stun-lock infinito (sempre sobra uma janela para reagir).
- [ ] Nenhum `Math.random()` na simulação; nenhum NaN em posição, velocidade ou HP.
- [ ] `impact:event` é emitido em explosões, raios e golpes fortes.

---

## 15. ENTREGA

Implemente **tudo desta fase** e responda com o resumo, os controles, como testar e a lista de arquivos. **Não avance para a Fase 3 (teleporte)** até eu confirmar que a Fase 2 está funcionando.
