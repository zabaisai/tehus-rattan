'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getContacts } from '@/lib/contacts';
import { getCompanyUsers } from '@/lib/users';
import { createLead } from '@/lib/leads';
import { PipelineStage } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

interface LeadFormModalProps {
  pipelineId: string;
  stages: PipelineStage[];
  /**
   * Etapa preseleccionada. La pone «Agregar oportunidad» desde una fila del
   * tablero: quien pulsa el «+» de «Cotizado» está diciendo dónde la quiere, y
   * obligarle a volver a elegirla en el formulario es pedirle el dato dos
   * veces —y dejar que se equivoque en la segunda—.
   */
  etapaInicialId?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function LeadFormModal({
  pipelineId,
  stages,
  etapaInicialId,
  onClose,
  onCreated,
}: LeadFormModalProps) {
  const sortedStages = [...stages].sort((a, b) => a.order - b.order);

  // Sin preselección, la de ENTRADA y no «la primera por orden». Es la misma
  // distinción que hace el servidor con `isInitial`: dónde está dibujada una
  // etapa y por dónde se entra al embudo son cosas distintas, y en un embudo
  // reordenado la primera puede ser «Ganado».
  const etapaPorDefecto =
    etapaInicialId ??
    sortedStages.find((s) => s.isInitial)?.id ??
    sortedStages[0]?.id ??
    '';

  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [stageId, setStageId] = useState(etapaPorDefecto);
  const [value, setValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: contacts, isLoading: loadingContacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: getContacts,
  });

  const { data: users } = useQuery({
    queryKey: ['company-users'],
    queryFn: getCompanyUsers,
  });

  // El ejemplo del título se arma con el contacto elegido, no con un producto
  // de un sector concreto: esta pantalla la usan empresas de cualquier ramo.
  const contactoElegido = contacts?.find((c) => c.id === contactId);
  const nombreContacto = contactoElegido?.name || contactoElegido?.phone;
  const ejemploDeTitulo = nombreContacto
    ? `Ej.: Propuesta para ${nombreContacto}`
    : 'Describe la oportunidad';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!contactId) {
      setError('Selecciona un contacto');
      return;
    }
    if (!stageId) {
      setError('Selecciona una etapa');
      return;
    }

    setSaving(true);
    try {
      await createLead({
        title,
        contactId,
        pipelineId,
        stageId,
        value: value ? Number(value) : undefined,
        expectedCloseDate: expectedCloseDate
          ? new Date(expectedCloseDate).toISOString()
          : undefined,
        assignedTo: assignedTo || undefined,
      });
      onCreated();
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'Ocurrió un error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Nueva oportunidad" onClose={onClose} maxWidth="sm">
        <form onSubmit={handleSubmit}>
          <Field label="Título" required className="mb-3">
            <Input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={ejemploDeTitulo}
            />
          </Field>

          <Field label="Contacto" required className="mb-3">
            <Select
              required
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={loadingContacts}
            >
              <option value="">
                {loadingContacts ? 'Cargando contactos...' : 'Selecciona un contacto'}
              </option>
              {contacts?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Etapa" required className="mb-3">
            <Select
              required
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
            >
              {sortedStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <Field label="Valor">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Cierre esperado">
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Responsable" className="mb-4">
            <Select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {users
                ?.filter((u) => u.isActive)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
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
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
    </Modal>
  );
}
