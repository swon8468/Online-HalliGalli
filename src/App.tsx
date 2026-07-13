import { Route, Routes } from 'react-router-dom'
import AdminApp from './admin/AdminApp'
import ProtectedRoute from './auth/ProtectedRoute'
import Layout from './components/Layout'
import CreateRoom from './pages/CreateRoom'
import Friends from './pages/Friends'
import Game from './pages/Game'
import Home from './pages/Home'
import Auth from './pages/Auth'
import JoinRoom from './pages/JoinRoom'
import Online from './pages/Online'
import Practice from './pages/Practice'
import Rules from './pages/Rules'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="auth" element={<Auth />} />
        <Route path="create" element={<ProtectedRoute><CreateRoom /></ProtectedRoute>} />
        <Route path="join" element={<ProtectedRoute><JoinRoom /></ProtectedRoute>} />
        <Route path="online" element={<ProtectedRoute><Online /></ProtectedRoute>} />
        <Route path="practice" element={<ProtectedRoute><Practice /></ProtectedRoute>} />
        <Route path="rules" element={<Rules />} />
        <Route path="friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
        <Route path="game" element={<ProtectedRoute><Game /></ProtectedRoute>} />
      </Route>
      <Route path="admin" element={<AdminApp />} />
    </Routes>
  )
}
