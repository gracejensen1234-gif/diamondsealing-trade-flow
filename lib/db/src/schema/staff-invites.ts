import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { companyAccountsTable } from "./company-accounts";
import { appUsersTable } from "./app-users";

export const staffInvitesTable = pgTable("staff_invites", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companyAccountsTable.id),
  email: text("email").notNull(),
  name: text("name"),
  inviteCode: text("invite_code").notNull().unique(),
  role: text("role", { enum: ["admin"] }).notNull().default("admin"),
  status: text("status", { enum: ["pending", "accepted", "revoked", "expired"] }).notNull().default("pending"),
  invitedByUserId: integer("invited_by_user_id").references(() => appUsersTable.id),
  acceptedByUserId: integer("accepted_by_user_id").references(() => appUsersTable.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  emailStatus: text("email_status", { enum: ["not_configured", "sent", "failed"] }).notNull().default("not_configured"),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  emailMessageId: text("email_message_id"),
  emailError: text("email_error"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StaffInvite = typeof staffInvitesTable.$inferSelect;
export type InsertStaffInvite = typeof staffInvitesTable.$inferInsert;
