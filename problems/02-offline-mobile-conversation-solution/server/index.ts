import { createHttpServer } from './httpServer';

const port = Number(process.env.PORT ?? 4000);
const { server } = createHttpServer();
server.listen(port, '0.0.0.0', () => {
  console.log(`Mock backend listening on http://0.0.0.0:${port}`);
  console.log('Fault injection: POST /admin/faults {"failNext":3} | {"dropAckNext":1} | {"rejectNext":1} | {"latencyMs":2000}');
});
