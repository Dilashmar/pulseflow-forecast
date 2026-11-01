import { Banner } from "./Banner";
import { bannerView } from "./bannerView";
import { forecast } from "./data";

export function App() {
  const view = bannerView(forecast);
  return (
    <div className="app">
      <header className="app-header">
        <h1>{view.title}</h1>
        <p className="as-of">{view.asOf}</p>
      </header>
      <Banner view={view} />
    </div>
  );
}
