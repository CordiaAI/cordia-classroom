# Canvas + classes browser test

Runs entirely locally: the real canvas/classes/sharing routers on an in-memory database,
a mocked Canvas API and a mocked Supabase Auth. Nothing reaches Supabase, Canvas or production.

    python tests/e2e/canvas_test_server.py &          # :8100
    (cd web && npx next build && npx next start -p 3100) &
    node tests/e2e/canvas-classes.e2e.cjs
