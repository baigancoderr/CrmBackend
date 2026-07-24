const taskCommentService = require("./taskComment.service");

const addComment = async (req, res) => {
  try {
    const comment = await taskCommentService.addComment(req.params.id, req.params.taskId, req.user, req.body);
    return res.status(201).json({ success: true, message: "Comment added successfully.", data: comment });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listComments = async (req, res) => {
  try {
    const comments = await taskCommentService.listComments(req.params.id, req.params.taskId, req.user);
    return res.status(200).json({ success: true, data: comments });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = { addComment, listComments };
