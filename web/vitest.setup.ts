import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `globals: true`, a Testing Library não desmonta sozinha entre testes.
afterEach(() => cleanup());
