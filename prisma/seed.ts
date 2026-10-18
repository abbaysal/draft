import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/server/seed";

const prisma = new PrismaClient();
seedDatabase(prisma, { log: (m) => console.log(m) })
  .then((r) => console.log("seed complete", r))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
