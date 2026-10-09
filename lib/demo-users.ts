// Fictional demo identities (one per role). IDs are fixed so seeds, tests and fixtures agree.
// In AWS these ids become the Cognito `sub` values of the seeded Cognito users.
import type { Role } from "@/types/api";

export interface DemoUser { id: string; email: string; name: string; role: Role; station: string; stationCode?: string; clearance: number }

export const DEMO_USERS: DemoUser[] = [
  { id: "a0000000-0000-4000-8000-000000000001", email: "police@sakshya.demo", name: "Inspector Aditi Patil", role: "POLICE", station: "Gangapur Police Station", stationCode: "GNG", clearance: 3 },
  { id: "a0000000-0000-4000-8000-000000000002", email: "lab@sakshya.demo", name: "Dr. Neha Kulkarni", role: "FORENSIC_LAB", station: "Nashik Forensic Science Laboratory", clearance: 3 },
  { id: "a0000000-0000-4000-8000-000000000003", email: "prosecutor@sakshya.demo", name: "Adv. Rohan Deshmukh", role: "PUBLIC_PROSECUTOR", station: "District Court, Nashik", clearance: 4 },
  { id: "a0000000-0000-4000-8000-000000000004", email: "judge@sakshya.demo", name: "Justice Meera Joshi", role: "JUDGE", station: "District Court, Nashik", clearance: 5 },
  { id: "a0000000-0000-4000-8000-000000000005", email: "admin@sakshya.demo", name: "Demo Administrator", role: "ADMIN", station: "Sakshya Operations", clearance: 5 },
  { id: "a0000000-0000-4000-8000-000000000006", email: "advocate@sakshya.demo", name: "Adv. Sanjay Rao", role: "DEFENCE_ADVOCATE", station: "", clearance: 1 },
  { id: "a0000000-0000-4000-8000-000000000007", email: "complainant@sakshya.demo", name: "Suresh Pawar", role: "COMPLAINANT", station: "", clearance: 0 },
  { id: "a0000000-0000-4000-8000-000000000008", email: "police2@sakshya.demo", name: "Inspector Vikram Shinde", role: "POLICE", station: "Panchavati Police Station", stationCode: "PCV", clearance: 3 },
  { id: "a0000000-0000-4000-8000-000000000009", email: "police3@sakshya.demo", name: "Inspector Rahul Jadhav", role: "POLICE", station: "Nashik Road Police Station", stationCode: "NSR", clearance: 3 },
];

export const demoUserByRole = (role: Role) => DEMO_USERS.find((u) => u.role === role)!;
