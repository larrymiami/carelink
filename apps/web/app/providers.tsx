"use client";
import { createTheme, ThemeProvider, CssBaseline } from "@mui/material";
const theme = createTheme({
  palette: {
    primary: { main: "#246451", dark: "#174638", contrastText: "#fff" },
    background: { default: "#f4f6f4", paper: "#fff" },
    text: { primary: "#1c302a", secondary: "#65736d" },
    divider: "#e2e8e3",
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h3: { fontSize: "2rem", fontWeight: 650, letterSpacing: "-.055em" },
    h5: { fontWeight: 650, letterSpacing: "-.035em" },
    h6: { fontWeight: 650, fontSize: "1rem" },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 9, minHeight: 40 } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600, fontSize: 11, height: 25 } },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { backgroundColor: "#fff", fontSize: 14 } },
    },
  },
});
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
