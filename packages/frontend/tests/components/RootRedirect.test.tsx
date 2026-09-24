import { beforeEach, describe, it, expect, vi } from "vitest";
import { render } from "@solidjs/testing-library";

const mockNavigate = vi.fn();
let mockEmbeddedMode = false;

vi.mock("@solidjs/router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../src/services/setup-status.js", () => ({
  checkIsEmbeddedMode: () => Promise.resolve(mockEmbeddedMode),
}));

import RootRedirect from "../../src/components/RootRedirect";

describe("RootRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbeddedMode = false;
  });

  it("redirects the root path to the global Overview", async () => {
    render(() => <RootRedirect />);
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/overview", { replace: true }),
    );
  });

  it("redirects the root path to usage-based providers in Embedded mode", async () => {
    mockEmbeddedMode = true;
    render(() => <RootRedirect />);
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/providers/usage-based", { replace: true }),
    );
  });
});
