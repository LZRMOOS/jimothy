import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Dropdown } from "./Dropdown";

const options = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

describe("Dropdown", () => {
  it("renders the selected option label", () => {
    render(<Dropdown options={options} value="light" onChange={() => {}} />);
    expect(screen.getByText("Light")).toBeInTheDocument();
  });

  it("opens menu on click", () => {
    render(<Dropdown options={options} value="system" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Dark" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /System/i }));
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
  });

  it("calls onChange with the selected value", () => {
    const onChange = vi.fn();
    render(<Dropdown options={options} value="system" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /System/i }));
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("closes menu after selection", () => {
    render(<Dropdown options={options} value="system" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /System/i }));
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(screen.queryByRole("button", { name: "Dark" })).not.toBeInTheDocument();
  });

  it("closes menu on Escape", () => {
    render(<Dropdown options={options} value="system" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /System/i }));
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Dark" })).not.toBeInTheDocument();
  });

  it("marks the active item as selected", () => {
    render(<Dropdown options={options} value="dark" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Dark/i }));
    const darkItem = screen.getAllByRole("button", { name: "Dark" })[1];
    expect(darkItem).toHaveClass("selected");
  });
});
