import { useState } from 'react'
import { useTizenKeys } from './hooks/useTizenKeys'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  useTizenKeys({
    onEnter: () => setCount(c => c + 1),
    onBack: () => console.log('Back pressed'),
  });

  return (
    <div className="tv-app">
      <h1>Tizen TV App</h1>
      <div className="content">
        <button onClick={() => setCount(count + 1)} autoFocus>
          Count: {count}
        </button>
        <p>Press ENTER on remote to increment</p>
      </div>
    </div>
  )
}

export default App
