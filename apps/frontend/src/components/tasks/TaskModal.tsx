"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLeads } from "@/lib/leads";
import { getContacts } from "@/lib/contacts";
import { getCompanyUsers } from "@/lib/users";
import { Task } from "@/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

export interface TaskFormData {
  title: string;
  description: string;
  dueDate: string;
  priority: string;
  type: string;
  status: string;
  leadId: string;
  contactId: string;
  assignedTo: string;
}

interface TaskModalProps {
  task?: Task | null;
  onClose: () => void;
  onSubmit: (data: TaskFormData) => Promise<void>;
}

const typeLabels: Record<string, string> = {
  TASK: "Tarea",
  FOLLOW_UP: "Seguimiento",
  CALL: "Llamada",
  MEETING: "Reunión",
};

export function TaskModal({ task, onClose, onSubmit }: TaskModalProps) {
  const isEditing = !!task;

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(
    task?.dueDate ? task.dueDate.slice(0, 16) : "",
  );
  const [priority, setPriority] = useState<string>(task?.priority ?? "MEDIUM");
  const [type] = useState<string>(task?.type ?? "TASK");
  const [status, setStatus] = useState<string>(task?.status ?? "PENDING");
  const [leadId, setLeadId] = useState(task?.leadId ?? "");
  const [contactId, setContactId] = useState(task?.contactId ?? "");
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data: leads,
    isLoading: loadingLeads,
    isError: leadsError,
  } = useQuery({
    queryKey: ["leads"],
    queryFn: () => getLeads(),
    enabled: !isEditing,
  });

  const {
    data: contacts,
    isLoading: loadingContacts,
    isError: contactsError,
  } = useQuery({
    queryKey: ["contacts"],
    queryFn: getContacts,
    enabled: !isEditing,
  });

  const { data: users, isError: usersError } = useQuery({
    queryKey: ["company-users"],
    queryFn: getCompanyUsers,
  });

  function handleLeadChange(newLeadId: string) {
    setLeadId(newLeadId);
    const selectedLead = leads?.find((l) => l.id === newLeadId);
    if (selectedLead?.contactId) {
      setContactId(selectedLead.contactId);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSubmit({
        title,
        description,
        dueDate,
        priority,
        type,
        status,
        leadId,
        contactId,
        assignedTo,
      });
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || "Ocurrió un error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEditing ? "Editar tarea" : "Nueva tarea"}
      onClose={onClose}
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit}>
        <Field label="Título" required className="mb-3">
          <Input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Llamar al cliente"
          />
        </Field>

        <Field label="Descripción" className="mb-3">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </Field>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label="Fecha límite">
            <Input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field label="Prioridad">
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </Select>
          </Field>
        </div>

        {!isEditing && (
          <Field label="Tipo" className="mb-3">
            <Select value={type} disabled>
              <option value="TASK">Tarea</option>
              <option value="FOLLOW_UP">Seguimiento</option>
              <option value="CALL">Llamada</option>
              <option value="MEETING">Reunión</option>
            </Select>
          </Field>
        )}

        {isEditing && (
          <Field label="Estado" className="mb-3">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PENDING">Pendiente</option>
              <option value="IN_PROGRESS">En progreso</option>
              <option value="COMPLETED">Completada</option>
              <option value="CANCELLED">Cancelada</option>
            </Select>
          </Field>
        )}

        {isEditing ? (
          <div className="mb-3 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
            <p>
              Tipo:{" "}
              <span className="text-neutral-700">
                {typeLabels[type] ?? type}
              </span>
            </p>
            <p className="mt-0.5">
              Lead:{" "}
              <span className="text-neutral-700">
                {task?.lead?.title ?? "Sin vincular"}
              </span>
            </p>
            <p className="mt-0.5">
              Contacto:{" "}
              <span className="text-neutral-700">
                {task?.contact?.name ?? "Sin vincular"}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-neutral-400">
              El lead y el contacto de una tarea no se pueden cambiar después de
              creada.
            </p>
          </div>
        ) : (
          <>
            {leadsError ? (
              <p role="alert" className="mb-3 text-xs text-status-error">
                No se pudieron cargar los leads.
              </p>
            ) : (
              <Field label="Lead relacionado" className="mb-3">
                <Select
                  value={leadId}
                  onChange={(e) => handleLeadChange(e.target.value)}
                  disabled={loadingLeads}
                >
                  <option value="">
                    {loadingLeads
                      ? "Cargando leads..."
                      : "Sin lead (tarea general)"}
                  </option>
                  {leads?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {contactsError ? (
              <p role="alert" className="mb-3 text-xs text-status-error">
                No se pudieron cargar los contactos.
              </p>
            ) : (
              <Field label="Contacto relacionado" className="mb-3">
                <Select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  disabled={loadingContacts}
                >
                  <option value="">
                    {loadingContacts
                      ? "Cargando contactos..."
                      : "Sin contacto (tarea interna)"}
                  </option>
                  {contacts?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        <div className="mb-4">
          {usersError ? (
            <p role="alert" className="text-xs text-status-error">
              No se pudieron cargar los usuarios.
            </p>
          ) : (
            <Field label="Responsable">
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
          )}
          {isEditing && !assignedTo && task?.assignedTo && (
            <p className="mt-1 text-[11px] text-neutral-400">
              Esta tarea ya tiene responsable asignado; el backend no permite
              quitarlo, solo reasignarlo.
            </p>
          )}
        </div>

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
