import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoadingPage from "./pages/LoadingPage";
import CardPaymentPage from "./pages/CardPaymentPage";
import ResultPage from "./pages/ResultPage";

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/loading" element={<LoadingPage basePath="" />} />
        <Route path="/pay" element={<CardPaymentPage basePath="" />} />
        <Route path="/result" element={<ResultPage basePath="" />} />

        <Route
          path="/cp2nus/loading"
          element={<LoadingPage basePath="/cp2nus" />}
        />
        <Route
          path="/cp2nus/pay"
          element={<CardPaymentPage basePath="/cp2nus" />}
        />
        <Route
          path="/cp2nus/result"
          element={<ResultPage basePath="/cp2nus" />}
        />
        <Route path="*" element={<Navigate to="/loading" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
