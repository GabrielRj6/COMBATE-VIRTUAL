/**
 * Comando determinístico gerado a cada tick (60Hz).
 * Enviado pela rede ao Host/Servidor no multiplayer online.
 */
export interface PlayerCommand {
  tick: number;
  moveForward: number;
  moveRight: number;
  moveUp: number;
  cameraYaw: number;
  cameraPitch: number;
  boost: boolean;
  charge: boolean;
  defend: boolean;
  jumpPressed: boolean;
  flyTogglePressed: boolean;
  dashPressed: boolean;
  lockOnPressed: boolean;
  teleportPressed: boolean;
  lightAttack: boolean;
  heavyAttack: boolean;
  skillSlot: number;
}

export interface InputCallbacks {
  onToggleDebug?: () => void;
  onToggleControlsDock?: () => void;
  onToggleMenu?: () => void;
  onPointerLockChange?: (locked: boolean) => void;
}

/**
 * Converte entradas de teclado, mouse e gamepad em comandos normalizados.
 * Suporta pausa limpa quando modais (Customização / Online) estão abertos.
 */
export class Input {
  private keys = new Set<string>();
  private targetEl: HTMLElement;
  private callbacks: InputCallbacks;

  public cameraYaw = 0;
  public cameraPitch = 0.22;
  public cameraDistance = 7.5;
  public isPointerLocked = false;
  public paused = false;

  private isDragging = false;
  private dragButton = -1;
  private dragDistance = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private pendingJump = false;
  private pendingFlyToggle = false;
  private pendingDash = false;
  private pendingLockOn = false;
  private pendingTeleport = false;
  private pendingLightAttack = false;
  private pendingHeavyAttack = false;
  private pendingSkillSlot = 0;

  private prevGamepadButtons: boolean[] = [];

  public mouseSensitivity = 0.0024;
  public gamepadLookSpeed = 2.4;

  private readonly commandBuffer: PlayerCommand = {
    tick: 0,
    moveForward: 0,
    moveRight: 0,
    moveUp: 0,
    cameraYaw: 0,
    cameraPitch: 0.22,
    boost: false,
    charge: false,
    defend: false,
    jumpPressed: false,
    flyTogglePressed: false,
    dashPressed: false,
    lockOnPressed: false,
    teleportPressed: false,
    lightAttack: false,
    heavyAttack: false,
    skillSlot: 0,
  };

  constructor(targetEl: HTMLElement, callbacks: InputCallbacks = {}) {
    this.targetEl = targetEl;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.isDragging = false;
      this.dragButton = -1;
      this.exitPointerLock();
    }
  }

  public requestPointerLock(): void {
    if (this.paused) return;
    try {
      const promise = this.targetEl.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
    } catch {
      // Fallback de arrastar permanece funcional
    }
  }

  public exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }

  public resetCameraBehind(yaw = 0): void {
    this.cameraYaw = yaw;
    this.cameraPitch = 0.22;
    this.cameraDistance = 7.5;
  }

  public steerCamera(targetYaw: number, targetPitch: number, dt: number, lambda = 7.0): void {
    const factor = 1 - Math.exp(-lambda * dt);
    let diff = ((targetYaw - this.cameraYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.cameraYaw += diff * factor;
    this.cameraPitch = Math.max(
      -1.18,
      Math.min(1.22, this.cameraPitch + (targetPitch - this.cameraPitch) * factor),
    );
  }

  public updateContinuousLook(dt: number): void {
    if (this.paused) return;
    const keyTurnSpeed = 2.1;
    if (this.keys.has('ArrowLeft')) this.cameraYaw += keyTurnSpeed * dt;
    if (this.keys.has('ArrowRight')) this.cameraYaw -= keyTurnSpeed * dt;
    if (this.keys.has('ArrowUp')) this.cameraPitch -= keyTurnSpeed * 0.75 * dt;
    if (this.keys.has('ArrowDown')) this.cameraPitch += keyTurnSpeed * 0.75 * dt;

    const gp = this.getActiveGamepad();
    if (gp) {
      const rx = Math.abs(gp.axes[2] ?? 0) > 0.14 ? (gp.axes[2] ?? 0) : 0;
      const ry = Math.abs(gp.axes[3] ?? 0) > 0.14 ? (gp.axes[3] ?? 0) : 0;
      this.cameraYaw -= rx * this.gamepadLookSpeed * dt;
      this.cameraPitch += ry * this.gamepadLookSpeed * 0.75 * dt;
    }

    this.cameraPitch = Math.max(-1.18, Math.min(1.22, this.cameraPitch));
  }

  public sampleCommand(tick: number): PlayerCommand {
    const cmd = this.commandBuffer;
    cmd.tick = tick;

    if (this.paused) {
      cmd.moveForward = 0;
      cmd.moveRight = 0;
      cmd.moveUp = 0;
      cmd.cameraYaw = this.cameraYaw;
      cmd.cameraPitch = this.cameraPitch;
      cmd.boost = false;
      cmd.charge = false;
      cmd.defend = false;
      cmd.jumpPressed = false;
      cmd.flyTogglePressed = false;
      cmd.dashPressed = false;
      cmd.lockOnPressed = false;
      cmd.teleportPressed = false;
      cmd.lightAttack = false;
      cmd.heavyAttack = false;
      cmd.skillSlot = 0;
      return cmd;
    }

    let moveForward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    let moveRight = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let moveUp =
      (this.keys.has('Space') ? 1 : 0) -
      (this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? 1 : 0);

    let boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let charge = this.keys.has('KeyC');
    let defend = this.keys.has('KeyE');

    const gp = this.getActiveGamepad();
    if (gp) {
      const lx = Math.abs(gp.axes[0] ?? 0) > 0.14 ? (gp.axes[0] ?? 0) : 0;
      const ly = Math.abs(gp.axes[1] ?? 0) > 0.14 ? -(gp.axes[1] ?? 0) : 0;
      if (Math.abs(lx) > Math.abs(moveRight)) moveRight = lx;
      if (Math.abs(ly) > Math.abs(moveForward)) moveForward = ly;

      const btnA = Boolean(gp.buttons[0]?.pressed);
      const btnB = Boolean(gp.buttons[1]?.pressed);
      const btnX = Boolean(gp.buttons[2]?.pressed);
      const btnY = Boolean(gp.buttons[3]?.pressed);
      const btnLB = Boolean(gp.buttons[4]?.pressed);
      const btnRB = Boolean(gp.buttons[5]?.pressed);
      const btnLT = (gp.buttons[6]?.value ?? 0) > 0.35;
      const btnRT = (gp.buttons[7]?.value ?? 0) > 0.35;
      const btnR3 = Boolean(gp.buttons[11]?.pressed);

      if (btnA) moveUp = Math.max(moveUp, 1);
      if (btnB) moveUp = Math.min(moveUp, -1);
      if (btnRB) boost = true;
      if (btnLT) charge = true;
      if (btnLB) defend = true;

      if (btnA && !this.prevGamepadButtons[0]) this.pendingJump = true;
      if (btnY && !this.prevGamepadButtons[3]) this.pendingFlyToggle = true;
      if (btnLB && !this.prevGamepadButtons[4] && (Math.abs(moveForward) > 0.1 || Math.abs(moveRight) > 0.1)) {
        this.pendingDash = true;
      }
      if (btnX && !this.prevGamepadButtons[2]) this.pendingLightAttack = true;
      if (btnRT && !this.prevGamepadButtons[7]) this.pendingTeleport = true;
      if (btnR3 && !this.prevGamepadButtons[11]) this.pendingLockOn = true;

      for (let i = 0; i < 12; i++) {
        this.prevGamepadButtons[i] = Boolean(gp.buttons[i]?.pressed);
      }
    }

    const horizLen = Math.hypot(moveForward, moveRight);
    if (horizLen > 1) {
      moveForward /= horizLen;
      moveRight /= horizLen;
    }

    cmd.moveForward = moveForward;
    cmd.moveRight = moveRight;
    cmd.moveUp = moveUp;
    cmd.cameraYaw = this.cameraYaw;
    cmd.cameraPitch = this.cameraPitch;
    cmd.boost = boost;
    cmd.charge = charge;
    cmd.defend = defend;
    cmd.jumpPressed = this.pendingJump;
    cmd.flyTogglePressed = this.pendingFlyToggle;
    cmd.dashPressed = this.pendingDash;
    cmd.lockOnPressed = this.pendingLockOn;
    cmd.teleportPressed = this.pendingTeleport;
    cmd.lightAttack = this.pendingLightAttack;
    cmd.heavyAttack = this.pendingHeavyAttack;
    cmd.skillSlot = this.pendingSkillSlot;

    this.pendingJump = false;
    this.pendingFlyToggle = false;
    this.pendingDash = false;
    this.pendingLockOn = false;
    this.pendingTeleport = false;
    this.pendingLightAttack = false;
    this.pendingHeavyAttack = false;
    this.pendingSkillSlot = 0;

    return cmd;
  }

  private getActiveGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i]!.connected) return pads[i];
    }
    return null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Se usuário está digitando num input de texto (nome / código da sala), não intercepta
    const target = e.target as HTMLElement | null;
    const isTypingField =
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (e.code === 'Escape' && !e.repeat) {
      if (!this.isPointerLocked) {
        this.callbacks.onToggleMenu?.();
      }
      return;
    }

    if (this.paused || isTypingField) return;

    if (
      e.code === 'Space' ||
      e.code === 'Tab' ||
      e.code === 'F3' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (e.code === 'F3') {
      this.callbacks.onToggleDebug?.();
      return;
    }

    if (e.code === 'KeyH' && !e.repeat) {
      this.callbacks.onToggleControlsDock?.();
      return;
    }

    const wasDown = this.keys.has(e.code);
    this.keys.add(e.code);

    if (!wasDown) {
      if (e.code === 'Space') this.pendingJump = true;
      if (e.code === 'KeyF') this.pendingFlyToggle = true;
      if (e.code === 'KeyE') {
        const hasMove =
          this.keys.has('KeyW') ||
          this.keys.has('KeyS') ||
          this.keys.has('KeyA') ||
          this.keys.has('KeyD');
        if (hasMove) this.pendingDash = true;
      }
      if (e.code === 'Tab') this.pendingLockOn = true;
      if (e.code === 'KeyQ') this.pendingTeleport = true;
      if (e.code === 'Digit1') this.pendingSkillSlot = 1;
      if (e.code === 'Digit2') this.pendingSkillSlot = 2;
      if (e.code === 'Digit3') this.pendingSkillSlot = 3;
      if (e.code === 'Digit4') this.pendingSkillSlot = 4;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.isDragging = false;
    this.dragButton = -1;
  };

  private onPointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.targetEl;
    if (this.isPointerLocked) {
      this.isDragging = false;
      this.dragButton = -1;
    }
    this.callbacks.onPointerLockChange?.(this.isPointerLocked);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.paused) return;
    if (this.isPointerLocked) {
      const dx = Math.max(-120, Math.min(120, e.movementX));
      const dy = Math.max(-120, Math.min(120, e.movementY));
      this.cameraYaw -= dx * this.mouseSensitivity;
      this.cameraPitch = Math.max(
        -1.18,
        Math.min(1.22, this.cameraPitch + dy * this.mouseSensitivity),
      );
    } else if (this.isDragging) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.dragDistance += Math.hypot(dx, dy);
      this.cameraYaw -= dx * this.mouseSensitivity * 1.45;
      this.cameraPitch = Math.max(
        -1.18,
        Math.min(1.22, this.cameraPitch + dy * this.mouseSensitivity * 1.45),
      );
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.paused) return;
    if (e.button === 1) {
      e.preventDefault();
      this.pendingLockOn = true;
      return;
    }

    if (this.isPointerLocked) {
      if (e.button === 0) this.pendingLightAttack = true;
      if (e.button === 2) this.pendingHeavyAttack = true;
      return;
    }

    if (e.button === 0 || e.button === 2) {
      this.isDragging = true;
      this.dragButton = e.button;
      this.dragDistance = 0;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }
  };

  private onMouseUp = (): void => {
    if (!this.paused && !this.isPointerLocked && this.isDragging && this.dragDistance < 6) {
      if (this.dragButton === 0) this.pendingLightAttack = true;
      else if (this.dragButton === 2) this.pendingHeavyAttack = true;
    }
    this.isDragging = false;
    this.dragButton = -1;
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.paused) return;
    this.cameraDistance = Math.max(
      4.0,
      Math.min(16.0, this.cameraDistance + Math.sign(e.deltaY) * 0.7),
    );
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.targetEl.addEventListener('mousedown', this.onMouseDown);
    this.targetEl.addEventListener('wheel', this.onWheel, { passive: true });
    this.targetEl.addEventListener('contextmenu', this.onContextMenu);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.targetEl.removeEventListener('mousedown', this.onMouseDown);
    this.targetEl.removeEventListener('wheel', this.onWheel);
    this.targetEl.removeEventListener('contextmenu', this.onContextMenu);
  }
}
