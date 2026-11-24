/**
 * Máquina de estados de combate e movimentação do guerreiro (Seção 4.1).
 */
export enum FighterState {
  GROUNDED = 'GROUNDED',
  FLYING = 'FLYING',
  DASHING = 'DASHING',
  ATTACKING = 'ATTACKING',
  CHARGING = 'CHARGING',
  STUNNED = 'STUNNED',
  KNOCKBACK = 'KNOCKBACK',
  TELEPORTING = 'TELEPORTING',
  DEAD = 'DEAD',
}

export interface FighterSnapshot {
  hp: number;
  maxHp: number;
  ki: number;
  maxKi: number;
  stamina: number;
  maxStamina: number;
  powerLevel: number;
  state: FighterState;
}

/**
 * Atributos vitais e consumo/regeneração de energia do guerreiro.
 */
export class Fighter {
  public hp = 1000;
  public maxHp = 1000;

  public ki = 100;
  public maxKi = 100;

  public stamina = 100;
  public maxStamina = 100;

  public powerLevel = 1.0;
  public state: FighterState = FighterState.GROUNDED;

  // Taxas por segundo
  public readonly passiveKiRegen = 4.5;
  public readonly chargeKiRegen = 34.0;
  public readonly boostKiCost = 16.0;
  public readonly dashStaminaCost = 24.0;
  public readonly staminaRegen = 22.0;

  private staminaRegenDelay = 0;

  public updateResources(dt: number, isBoosting: boolean, isCharging: boolean): void {
    if (this.state === FighterState.DEAD) return;

    // Ki: boost consome, carregar regenera rápido, neutro regenera devagar
    if (isBoosting) {
      this.ki = Math.max(0, this.ki - this.boostKiCost * dt);
    } else if (isCharging) {
      this.ki = Math.min(this.maxKi, this.ki + this.chargeKiRegen * dt);
    } else {
      this.ki = Math.min(this.maxKi, this.ki + this.passiveKiRegen * dt);
    }

    // Stamina: regenera após pequeno atraso
    if (this.staminaRegenDelay > 0) {
      this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - dt);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * dt);
    }
  }

  public tryConsumeStamina(amount: number): boolean {
    if (this.stamina < amount) return false;
    this.stamina -= amount;
    this.staminaRegenDelay = 0.65;
    return true;
  }

  public canBoost(): boolean {
    return this.ki > 1.5;
  }

  public toJSON(): FighterSnapshot {
    return {
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      ki: Number(this.ki.toFixed(1)),
      maxKi: this.maxKi,
      stamina: Number(this.stamina.toFixed(1)),
      maxStamina: this.maxStamina,
      powerLevel: this.powerLevel,
      state: this.state,
    };
  }
}
