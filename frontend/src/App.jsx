import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import LoadingPage from "./pages/LoadingPage";
import CardPaymentPage from "./pages/CardPaymentPage";
import ResultPage from "./pages/ResultPage";
import TermsPage from "./pages/TermsPage";

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        {/* Entry point — hostel selection + meter details */}
        <Route path="/" element={<HomePage />} />
        <Route path="/terms" element={<TermsPage />} />

        {/* cp2 flow — PGPR, PGP Houses, Residential Colleges, NUS College */}
        <Route path="/loading" element={<LoadingPage basePath="" />} />
        <Route path="/pay" element={<CardPaymentPage basePath="" />} />
        <Route path="/result" element={<ResultPage basePath="" />} />

        {/* cp2nus flow — UTown Residence, RVRC */}
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
      </Routes>
    </BrowserRouter>
  );
}
