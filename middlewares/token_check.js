const authenticate_token=(req,res,next)=>{
    const auth_header=req.headers['authorization'];
    if(!auth_header){
        return res.status(400).json('No token given');
    }
    const token_secret=auth_header.split(' ')[1]
    jwt.verify(token_secret, process.env.JWT_SECRET, (err, user) => {
        if(err) {
            return res.status(403).json({message:'Invalid or expired token'});
        }
        req.user = user; 
        next(); 
    });
    
}

module.exports=authenticate_token;