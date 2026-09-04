import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { DeviceVerificationForm } from './DeviceVerificationForm';
import type { DeviceChallenge } from '@/lib/login-machine';

const AHORA = Date.parse('2026-09-04T12:00:00.000Z');

function reto(parcial: Partial<DeviceChallenge> = {}): DeviceChallenge {
  return {
    challengeId: 'ret-1',
    maskedEmail: 'a***@empresa.com',
    expiresAt: new Date(AHORA + 300_000).toISOString(),
    resendAvailableAt: new Date(AHORA + 30_000).toISOString(),
    attemptsRemaining: 5,
    ...parcial,
  };
}

function montar(props: Partial<React.ComponentProps<typeof DeviceVerificationForm>> = {}) {
  const onVerify = vi.fn();
  const onResend = vi.fn();
  const onBack = vi.fn();
  const utilidades = render(
    <DeviceVerificationForm
      challenge={reto()}
      step="verification"
      error=""
      errorSeq={0}
      notice=""
      onVerify={onVerify}
      onResend={onResend}
      onBack={onBack}
      {...props}
    />,
  );
  return { onVerify, onResend, onBack, ...utilidades };
}

const digitos = () => screen.getAllByRole('textbox') as HTMLInputElement[];

function avanzar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('DeviceVerificationForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('muestra el correo enmascarado tal cual llega del servidor', () => {
    montar();
    expect(
      screen.getByText('Enviamos un código de 6 dígitos a a***@empresa.com.'),
    ).toBeInTheDocument();
  });

  it('pinta seis campos etiquetados y solo el primero autocompleta el código', () => {
    montar();
    const campos = digitos();
    expect(campos).toHaveLength(6);
    expect(screen.getByLabelText('Dígito 1 de 6')).toBe(campos[0]);
    expect(screen.getByLabelText('Dígito 6 de 6')).toBe(campos[5]);
    expect(campos[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(campos[1]).toHaveAttribute('autocomplete', 'off');
    expect(campos[0]).toHaveAttribute('inputmode', 'numeric');
  });

  it('el foco entra en el primer dígito al aparecer el paso', () => {
    montar();
    expect(document.activeElement).toBe(digitos()[0]);
  });

  it('escribir avanza al siguiente campo', () => {
    montar();
    const campos = digitos();
    fireEvent.change(campos[0], { target: { value: '4' } });
    expect(campos[0]).toHaveValue('4');
    expect(document.activeElement).toBe(campos[1]);
  });

  it('Retroceso sobre un campo vacío vuelve al anterior y lo borra', () => {
    montar();
    const campos = digitos();
    fireEvent.change(campos[0], { target: { value: '7' } });
    fireEvent.keyDown(campos[1], { key: 'Backspace' });
    expect(document.activeElement).toBe(campos[0]);
    expect(campos[0]).toHaveValue('');
  });

  it('las flechas mueven entre campos sin escribir nada', () => {
    montar();
    const campos = digitos();
    fireEvent.keyDown(campos[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(campos[1]);
    fireEvent.keyDown(campos[1], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(campos[0]);
    expect(campos.every((campo) => campo.value === '')).toBe(true);
  });

  it('pegar seis dígitos en cualquier campo los reparte y envía solo', () => {
    const { onVerify } = montar();
    const campos = digitos();
    fireEvent.paste(campos[2], {
      clipboardData: { getData: () => '482913' },
    });
    expect(campos.map((campo) => campo.value)).toEqual(['4', '8', '2', '9', '1', '3']);
    expect(onVerify).toHaveBeenCalledWith('482913', false);
  });

  it('la casilla de confianza está desmarcada y su valor viaja al verificar', () => {
    const { onVerify } = montar();
    const casilla = screen.getByRole('checkbox', {
      name: /Confiar en este dispositivo privado durante 30 días/,
    });
    expect(casilla).not.toBeChecked();

    fireEvent.click(casilla);
    fireEvent.paste(digitos()[0], { clipboardData: { getData: () => '111222' } });

    expect(onVerify).toHaveBeenCalledWith('111222', true);
  });

  it('cuenta atrás en m:ss y bloqueo del envío al vencer', () => {
    montar();
    expect(screen.getByText('El código vence en 5:00')).toBeInTheDocument();

    avanzar(61_000);
    expect(screen.getByText('El código vence en 3:59')).toBeInTheDocument();

    avanzar(240_000);
    expect(screen.getByText('El código venció. Pide uno nuevo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verificar' })).toBeDisabled();
  });

  it('el reenvío está deshabilitado hasta la hora que dio el servidor', () => {
    montar();
    const boton = screen.getByRole('button', { name: 'Enviar otro código' });
    expect(boton).toBeDisabled();
    expect(screen.getByText('Puedes pedir otro en 30s')).toBeInTheDocument();

    avanzar(30_000);
    expect(screen.getByRole('button', { name: 'Enviar otro código' })).toBeEnabled();
    expect(screen.queryByText(/Puedes pedir otro en/)).not.toBeInTheDocument();
  });

  it('un error vacía los dígitos, devuelve el foco al primero y se anuncia', () => {
    const { rerender } = montar();
    const campos = digitos();
    fireEvent.change(campos[0], { target: { value: '1' } });
    fireEvent.change(campos[1], { target: { value: '2' } });

    rerender(
      <DeviceVerificationForm
        challenge={reto()}
        step="verification"
        error="El código no es válido o ya venció. Solicita uno nuevo."
        errorSeq={1}
        notice=""
        onVerify={vi.fn()}
        onResend={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent(
      'El código no es válido o ya venció. Solicita uno nuevo.',
    );
    expect(digitos().every((campo) => campo.value === '')).toBe(true);
    expect(document.activeElement).toBe(digitos()[0]);
    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-describedby',
      alerta.getAttribute('id'),
    );
  });

  it('avisa de los intentos restantes solo cuando quedan pocos', () => {
    const { rerender } = montar();
    expect(screen.queryByText(/Te quedan/)).not.toBeInTheDocument();

    rerender(
      <DeviceVerificationForm
        challenge={reto({ attemptsRemaining: 2 })}
        step="verification"
        error=""
        errorSeq={0}
        notice=""
        onVerify={vi.fn()}
        onResend={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText('Te quedan 2 intentos.')).toBeInTheDocument();
  });

  it('la confirmación del reenvío se anuncia como estado', () => {
    montar({ notice: 'Te enviamos otro código.' });
    const estados = screen.getAllByRole('status');
    expect(
      estados.some((nodo) => nodo.textContent === 'Te enviamos otro código.'),
    ).toBe(true);
  });

  it('«Volver» avisa a la página y no toca la API', () => {
    const { onBack, onVerify, onResend } = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onVerify).not.toHaveBeenCalled();
    expect(onResend).not.toHaveBeenCalled();
  });

  it('no ofrece ningún código de prueba', () => {
    montar();
    expect(document.body.textContent).not.toMatch(/código de prueba/i);
  });
});
