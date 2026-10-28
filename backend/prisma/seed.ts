import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash('RelayDemo123!', 12);

const [maya, theo, lina] = await Promise.all([
  prisma.user.upsert({
    where: { email: 'maya@relay.local' },
    update: {},
    create: { email: 'maya@relay.local', username: 'maya', displayName: 'Maya Chen', passwordHash },
  }),
  prisma.user.upsert({
    where: { email: 'theo@relay.local' },
    update: {},
    create: {
      email: 'theo@relay.local',
      username: 'theo',
      displayName: 'Theo Martins',
      passwordHash,
    },
  }),
  prisma.user.upsert({
    where: { email: 'lina@relay.local' },
    update: {},
    create: { email: 'lina@relay.local', username: 'lina', displayName: 'Lina Park', passwordHash },
  }),
]);

const directKey = [maya.id, theo.id].sort().join(':');
await prisma.conversation.upsert({
  where: { directKey },
  update: {},
  create: {
    type: 'DIRECT',
    directKey,
    createdById: maya.id,
    members: { create: [{ userId: maya.id }, { userId: theo.id }] },
    messages: {
      create: [
        {
          senderId: theo.id,
          content: 'The Redis failover drill is green.',
          clientMessageId: 'seed-1',
        },
        {
          senderId: maya.id,
          content: 'Perfect. I’ll update the runbook.',
          clientMessageId: 'seed-2',
        },
      ],
    },
  },
});

await prisma.conversation.upsert({
  where: { directKey: 'seed:platform-group' },
  update: {},
  create: {
    type: 'GROUP',
    name: 'Platform crew',
    directKey: 'seed:platform-group',
    createdById: maya.id,
    members: {
      create: [
        { userId: maya.id, role: 'OWNER' },
        { userId: theo.id, role: 'ADMIN' },
        { userId: lina.id, role: 'MEMBER' },
      ],
    },
    messages: {
      create: {
        senderId: lina.id,
        content: 'Deploy window opens at 16:00.',
        clientMessageId: 'seed-group-1',
      },
    },
  },
});

await prisma.$disconnect();
