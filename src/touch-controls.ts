type Direction = 'left' | 'right' | 'jump';

export class TouchControls {
  private readonly coarse = matchMedia('(pointer: coarse)');
  private readonly upright = matchMedia('(orientation: portrait)');
  private readonly controls = document.querySelector<HTMLElement>('#touch-controls')!;
  private readonly prompt = document.querySelector<HTMLElement>('#orientation-prompt')!;
  private readonly overlay = document.querySelector<HTMLElement>('#overlay')!;
  private readonly held = new Map<number, Direction>();
  private jumpPressed = false;

  constructor(canPlay: () => boolean, pause: () => void) {
    const sync = () => {
      this.clear();
      this.controls.hidden = !this.enabled || this.portrait;
      this.prompt.hidden = !this.portrait;
      this.overlay.inert = this.portrait;
      if (this.portrait && canPlay()) pause();
    };
    this.coarse.addEventListener('change', sync);
    this.upright.addEventListener('change', sync);
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => this.clear());

    this.controls.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(button => {
      const action = button.dataset.hold as Direction;
      button.addEventListener('pointerdown', event => {
        if (!this.enabled || this.portrait || !canPlay() || event.button !== 0) return;
        event.preventDefault();
        if (action === 'jump' && !this.down('jump')) this.jumpPressed = true;
        this.held.set(event.pointerId, action);
        button.setPointerCapture(event.pointerId);
        button.classList.add('held');
      });
      const release = (event: PointerEvent) => {
        this.held.delete(event.pointerId);
        button.classList.toggle('held', this.down(action));
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    });
    this.controls.addEventListener('contextmenu', event => event.preventDefault());
    this.controls.querySelector('button[data-pause]')!.addEventListener('click', () => {
      if (!this.portrait && canPlay()) pause();
    });
    sync();
  }

  get enabled() {
    return this.coarse.matches;
  }

  get portrait() {
    return this.enabled && this.upright.matches;
  }

  down(action: Direction) {
    for (const pressed of this.held.values()) {
      if (action === pressed) return true;
    }
    return false;
  }

  consumeJump() {
    const pressed = this.jumpPressed;
    this.jumpPressed = false;
    return pressed;
  }

  clear() {
    this.held.clear();
    this.jumpPressed = false;
    this.controls.querySelectorAll('.held').forEach(button => button.classList.remove('held'));
  }
}
