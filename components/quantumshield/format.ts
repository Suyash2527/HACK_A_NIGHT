import type { ISODate, Role } from "@/types/api";
export const formatIST = (value: ISODate | null) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)) + " IST" : "—";
export const formatBytes = (value: number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
export const roleLabel = (role: Role) => ({ POLICE: "Police", FORENSIC_LAB: "Forensic lab", PUBLIC_PROSECUTOR: "Public prosecutor", JUDGE: "Judge", ADMIN: "Administrator", DEFENCE_ADVOCATE: "Defence advocate", COMPLAINANT: "Complainant" })[role];
export const shortHash = (value: string | null) => value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—";
