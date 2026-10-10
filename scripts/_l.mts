process.loadEnvFile(".env.local");
const pw = process.env.DEMO_PASSWORD!;
console.log("password length", pw.length, "has whitespace:", /\s/.test(pw));
for (const e of ["lab","police","judge","advocate","complainant","admin","prosecutor","police2","police3"]) {
  const r = await fetch("http://localhost:3000/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: e + "@sakshya.demo", password: pw }) });
  console.log(e, r.status);
}
