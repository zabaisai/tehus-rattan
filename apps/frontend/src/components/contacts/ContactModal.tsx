"use client";

import { useState } from 'react';
import { Contact } from "@/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

interface ContactModalProps {
  contact: Contact | null;
  onClose: () => void;
  onSubmit: (data: {
    phone: string;
    name: string;
    email: string;
  }) => Promise<void>;
}

export function ContactModal({
  contact,
  onClose,
  onSubmit,
}: ContactModalProps) {
const [phone, setPhone] = useState(contact?.phone ?? '');
  const [name, setName] = useState(contact?.name ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({ phone, name, email });
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || "Ocurrió un error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={contact ? "Editar contacto" : "Nuevo contacto"} onClose={onClose} maxWidth="sm">
        <form onSubmit={handleSubmit}>
          <Field
            label="Teléfono"
            required
            className="mb-3"
            hint={contact ? "El teléfono identifica al contacto y no se edita." : undefined}
          >
            <Input
              type="tel"
              required
              disabled={!!contact}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+573001234567"
            />
          </Field>

          <Field label="Nombre" className="mb-3">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del contacto"
            />
          </Field>

          <Field label="Correo" className="mb-4">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </Field>

          {error && (
            <p role="alert" className="mb-3 text-xs text-status-error">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={onClose} className="px-3 py-1.5">
              Cancelar
            </Button>
            <Button type="submit" disabled={saving} className="px-3 py-1.5">
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
    </Modal>
  );
}
