# Backend Permissions Matrix

Current branch: `develop`

This document describes the current backend permissions. It is descriptive only;
it does not change runtime behavior.

## Role Model

Roles currently present in `schema.prisma`:

- `SUPER_ADMIN`
- `ADMIN`
- `AGENT`

Controllers use two patterns:

- `AuthGuard('jwt')`: any authenticated user can access the endpoint.
- `AuthGuard('jwt')` + `RolesGuard` + `@Roles(...)`: endpoint is restricted to the listed roles.

## Matrix

| Module | Endpoint Group | Authentication | Role Restriction | Tenant Source |
| --- | --- | --- | --- | --- |
| Auth | `POST /auth/register` | Public | None | Request body creates company |
| Auth | `POST /auth/login` | Public | None | User lookup by email |
| Auth | `GET /auth/me` | JWT | Any authenticated role | JWT `sub` |
| Companies | `/companies/*` | JWT | `ADMIN`, `SUPER_ADMIN` for updates | JWT `companyId` |
| Users | `/users/*` | JWT | `ADMIN`, `SUPER_ADMIN` for create/update/delete | JWT `companyId` |
| Contacts | `/contacts/*` | JWT | Any authenticated role | JWT `companyId` |
| Conversations | `/conversations/*` | JWT | Any authenticated role | JWT `companyId` |
| Messages | via Conversations/Webhook/Automations services | Context-dependent | Context-dependent | Trusted service context `companyId` |
| Notes | `/notes/*` | JWT | Any authenticated role | JWT `companyId`, JWT `sub` for `createdBy` |
| Leads | `/leads/*` | JWT | Any authenticated role | JWT `companyId` |
| Tasks | `/tasks/*` | JWT | Any authenticated role | JWT `companyId` |
| Pipelines | read endpoints | JWT + RolesGuard | Any authenticated role when no method `@Roles` is present | JWT `companyId` |
| Pipelines | create/update/delete/reorder stages | JWT + RolesGuard | `ADMIN`, `SUPER_ADMIN` | JWT `companyId` |
| Automations | `/automations/*` | JWT + RolesGuard | `ADMIN`, `SUPER_ADMIN` | JWT `companyId` |
| Products | write endpoints | JWT + RolesGuard | `ADMIN`, `SUPER_ADMIN` | JWT `companyId` |
| Products | read endpoints | JWT + RolesGuard | Any authenticated role when no method `@Roles` is present | JWT `companyId` |
| Analytics | `/analytics/*` | JWT + RolesGuard | `ADMIN`, `SUPER_ADMIN` | JWT `companyId` |
| Webhook | `/webhook/*` | Public | None | Resolved from WhatsApp `phone_number_id` |

## Current Security Notes

- Tenant ownership should be derived from JWT or trusted backend context, never from request body.
- `companyId` is not accepted by reviewed DTOs for tenant-owned user workflows.
- `createdBy` for notes is taken from JWT `sub`.
- Current product behavior allows `AGENT` users to operate contacts, conversations, notes, leads, and tasks within their company.
- Changing `AGENT` capabilities is a business decision and is not part of the current stabilization changes.

## Recently Stabilized Ownership Checks

- JWT secret is mandatory and shared through `ConfigService`.
- Disabled users cannot log in.
- Message creation validates conversation ownership.
- Conversation assignment validates assigned user ownership and active state.
- Lead assignment validates assigned user ownership and active state.
- Task assignment validates assigned user ownership and active state.
- Task creation validates `leadId` and `contactId` ownership.
- Note creation validates `leadId` and `conversationId` ownership.
