import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('classeLedClock', () => {
    let agora: Date;

    beforeEach(() => {
      agora = new Date(2026, 0, 2, 12, 0, 0);
      vi.spyOn(Date, 'now').mockReturnValue(agora.getTime());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const valvulaComClock = (clock: string, clockAtualizado = true) => ({
      clock,
      clockAtualizado,
    });

    it('mostra verde para horário com até 5 minutos de diferença', () => {
      expect(component.classeLedClock(valvulaComClock('02/01/2026 11:55:00'))).toBe('led-green');
    });

    it('mostra amarelo para horário entre 5 e 15 minutos de diferença', () => {
      expect(component.classeLedClock(valvulaComClock('02/01/2026 11:54:59'))).toBe('led-yellow');
      expect(component.classeLedClock(valvulaComClock('02/01/2026 11:45:00'))).toBe('led-yellow');
    });

    it('mostra vermelho para horário com mais de 15 minutos de diferença', () => {
      expect(component.classeLedClock(valvulaComClock('02/01/2026 11:44:59'))).toBe('led-red');
    });

    it('mostra vermelho quando o relógio não está atualizado ou é inválido', () => {
      expect(component.classeLedClock(valvulaComClock('02/01/2026 11:59:00', false))).toBe('led-red');
      expect(component.classeLedClock(valvulaComClock('31/02/2026 11:59:00'))).toBe('led-red');
    });
  });
});
