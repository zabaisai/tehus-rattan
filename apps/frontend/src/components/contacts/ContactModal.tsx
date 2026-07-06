"use client";

import { useState } from 'react';
import { X } from "lucide-react";
import { Contact } from "@/types";

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
      setError((message?.[0] || message || "Ocurrió un error") as string);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">
            {contact ? "Editar contacto" : "Nuevo contacto"}
          </h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Teléfono
            </label>
            <input
              type="text"
              required
              disabled={!!contact}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+573001234567"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 disabled:bg-stone-100 disabled:text-stone-500"
            />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Nombre
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del contacto"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
          </div>

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Correo
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
            />
          </div>

          {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
