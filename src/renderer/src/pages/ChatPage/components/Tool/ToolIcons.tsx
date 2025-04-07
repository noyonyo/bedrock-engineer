import { ToolName, isMcpTool } from '@/types/tools'
import {
  FaFolderPlus,
  FaFileSignature,
  FaFileAlt,
  FaList,
  FaArrowRight,
  FaCopy,
  FaSearch,
  FaGlobe,
  FaImage,
  FaDatabase,
  FaTerminal,
  FaBrain,
  FaServer
} from 'react-icons/fa'
import { BiFace } from 'react-icons/bi'
import { MdDifference } from 'react-icons/md'

// Icon definitions for standard tools
const standardToolIcons = {
  createFolder: <FaFolderPlus className="text-blue-500 size-6" />,
  writeToFile: <FaFileSignature className="text-green-500 size-6" />,
  readFiles: <FaFileAlt className="text-yellow-500 size-6" />,
  listFiles: <FaList className="text-purple-500 size-6" />,
  moveFile: <FaArrowRight className="text-orange-500 size-6" />,
  copyFile: <FaCopy className="text-indigo-500 size-6" />,
  tavilySearch: <FaSearch className="text-red-500 size-6" />,
  fetchWebsite: <FaGlobe className="text-teal-500 size-6" />,
  generateImage: <FaImage className="text-pink-500 size-6" />,
  retrieve: <FaDatabase className="text-green-500 size-6" />,
  invokeBedrockAgent: <BiFace className="text-purple-700 size-6" />,
  executeCommand: <FaTerminal className="text-gray-500 size-6" />,
  applyDiffEdit: <MdDifference className="text-cyan-500 size-6" />,
  think: <FaBrain className="text-amber-500 size-6" />
}

// Icons for MCP tools (common to all MCP tools)
const mcpIcon = <FaServer className="text-cyan-500 size-6" />

// ツール名に応じて動的にアイコンを返すプロキシ
export const toolIcons = new Proxy({} as { [key in ToolName]: React.ReactElement }, {
  get: (_target, prop: string) => {
    // 標準ツールのアイコンがあればそれを返す
    if (prop in standardToolIcons) {
      return standardToolIcons[prop as keyof typeof standardToolIcons]
    }

    // MCPツールの場合
    if (isMcpTool(prop)) {
      // すべてのMCPツールには同じアイコンを返す
      return mcpIcon
    }

    // 未知のツールの場合もMCPアイコンを返す
    return mcpIcon
  }
})
